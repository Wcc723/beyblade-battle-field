/**
 * 線上對戰房 WS 客戶端：連 /api/room/:code/ws（Battle Room DO），
 * 把房間狀態同步進 useBattle（loadout/phase/回放），並提供操作（發射/換配置/下一回合）。
 *
 * 與 useBattle 的接線：
 * - useBattle({ onLaunchSubmit: (aim) => online.submitAim(aim) }) → 瞄準放手送伺服器
 * - online.bind(bt) → 收到 round 訊息時呼叫 bt.playRemoteRound()（兩端重跑同一份確定性模擬）
 */
import { computed, ref, watch } from "vue";
import type { useBattle } from "./useBattle";
import type { AimInput, PlayerLoadout, RoomSnapshot, RoundOutcome, ServerMsg, Side } from "../game/room";
import { getBey } from "../game/beyblades";
import { playLaunch } from "../audio/sfx";

type BT = ReturnType<typeof useBattle>;

const PING_INTERVAL_MS = 25_000;
const RETRY_MAX_MS = 10_000;

export interface UseOnlineBattleOptions {
  /** BOT 房：請伺服器讓內建 AI 入座另一側 */
  bot?: boolean;
}

export function useOnlineBattle(code: string, options: UseOnlineBattleOptions = {}) {
  const you = ref<Side | null>(null);
  const snapshot = ref<RoomSnapshot | null>(null);
  const lastOutcome = ref<RoundOutcome | null>(null);
  const connected = ref(false);
  const roomFull = ref(false);
  const superseded = ref(false); // 同帳號開了新分頁，本連線被取代
  const authLost = ref(false); // session 失效：停止重連
  const roomClosed = ref(false); // 房主關房（DO close 4002）：不重連，view 收到後回大廳
  const errorMsg = ref("");
  const opponentJustLaunched = ref(false);
  const sentLaunch = ref(false); // 本地已送出發射（伺服器 echo 前先擋重複瞄準）
  const opponentAdvanced = ref(false); // 對手已按下一回合、但我方回放還沒看完
  const now = ref(Date.now());
  let pendingAiming = false; // 暫存「進入瞄準」：等本地回放看完再套用，不硬切

  let bt: BT | null = null;
  let ws: WebSocket | null = null;
  let closedByUs = false;
  let retryMs = 1000;
  let consecutiveFails = 0; // 連續「沒 open 過就 close」（session 失效偵測）
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let nowTimer: ReturnType<typeof setInterval> | undefined;

  const me = computed(() => (you.value && snapshot.value ? snapshot.value.players[you.value] : undefined));
  const oppSide = computed<Side | null>(() => (you.value === "A" ? "B" : you.value === "B" ? "A" : null));
  const opponent = computed(() => (oppSide.value && snapshot.value ? snapshot.value.players[oppSide.value] : undefined));
  /** 本場 match 的場地（DO 從啟用池隨機抽出、整場固定）：footer 顯示用 */
  const matchArena = computed<{ id: string; name: string } | null>(() => {
    const s = snapshot.value;
    if (!s || (!s.arenaId && !s.arenaName)) return null;
    return { id: s.arenaId ?? "", name: s.arenaName ?? "" };
  });
  const myLaunched = computed(() => sentLaunch.value || !!me.value?.launched);
  /** 瞄準倒數（秒）；非瞄準階段 = null */
  const aimRemaining = computed(() => {
    const d = snapshot.value?.phase === "aiming" ? snapshot.value.aimDeadline : undefined;
    return d ? Math.max(0, Math.ceil((d - now.value) / 1000)) : null;
  });

  function bind(battle: BT): void {
    bt = battle;
    // 回放播完且有暫存的「進入瞄準」→ 讓 outcome 橫幅閃一下再切下一回合
    watch(battle.playing, (p) => {
      if (!p && pendingAiming && battle.isFinished()) {
        setTimeout(() => {
          if (pendingAiming) enterAiming();
        }, 1500);
      }
    });
  }

  /** 進入瞄準階段：清回合狀態 + phase 指到自己那側（makeInit 取對 setup） */
  function enterAiming(): void {
    if (!bt || !you.value) return;
    if (snapshot.value?.phase !== "aiming") {
      pendingAiming = false;
      return;
    }
    pendingAiming = false;
    opponentAdvanced.value = false;
    sentLaunch.value = false;
    opponentJustLaunched.value = false;
    bt.startRound();
    bt.phase.value = you.value === "A" ? "aim-A" : "aim-B";
  }

  /* ---------- 房間狀態 → useBattle 同步 ---------- */
  function applySnapshot(prevPhase: string | undefined): void {
    if (!bt || !snapshot.value || !you.value) return;
    const s = snapshot.value;
    // 雙方 loadout → setups（顏色固定 A 紅 B 藍；貼圖/必殺/旋向跟著伺服器真相）
    // loadout 只帶 beyId：類型由名冊（getBey）解析 → 貼圖/本機顯示用屬性跟著類型走
    for (const side of ["A", "B"] as Side[]) {
      const p = s.players[side];
      if (!p) continue;
      const setup = side === "A" ? bt.setupA : bt.setupB;
      setup.preset = getBey(p.loadout.beyId)?.type ?? "balance";
      setup.spinDir = p.loadout.spinDir;
      setup.special = p.loadout.special;
    }
    if (s.phase === "aiming") {
      if (prevPhase !== "aiming") {
        // 我方回放還沒看完（對手先按了下一回合）→ 暫存，看完再切，不硬砍回放
        if (bt.phase.value === "playing" && bt.result.value && !bt.isFinished()) {
          pendingAiming = true;
          opponentAdvanced.value = true;
          return;
        }
        enterAiming();
      } else if (bt.phase.value !== "playing") {
        // 重連進行中的瞄準：確保 phase 指到自己
        bt.phase.value = you.value === "A" ? "aim-A" : "aim-B";
      }
    }
  }

  function onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== "string" || ev.data === "pong") return;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case "room": {
        const prev = snapshot.value?.phase;
        you.value = msg.you;
        if (bt) bt.mySide.value = msg.you; // 勝負音視角：我方 side（win/lose 依此選）
        snapshot.value = msg.snapshot;
        applySnapshot(prev);
        return;
      }
      case "round": {
        lastOutcome.value = msg.payload.outcome;
        opponentJustLaunched.value = false;
        sentLaunch.value = false;
        pendingAiming = false;
        opponentAdvanced.value = false;
        bt?.playRemoteRound(msg.payload);
        return;
      }
      case "opponent-launched": {
        opponentJustLaunched.value = true;
        return;
      }
      case "error": {
        errorMsg.value = msg.code;
        return;
      }
    }
  }

  /* ---------- 連線管理（自動重連 + 保活） ---------- */
  function connect(): void {
    closedByUs = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws${options.bot ? "?bot=1" : ""}`);
    let opened = false;
    ws.onopen = () => {
      opened = true;
      consecutiveFails = 0;
      connected.value = true;
      retryMs = 1000;
      errorMsg.value = "";
    };
    ws.onmessage = onMessage;
    ws.onclose = async (e) => {
      connected.value = false;
      ws = null;
      if (e.code === 4001) {
        roomFull.value = true; // 滿房：不重連
        return;
      }
      if (e.code === 4000) {
        superseded.value = true; // 被新分頁取代：不重連
        return;
      }
      if (e.code === 4002) {
        roomClosed.value = true; // 房主關房：不重連（view watch 到後導回大廳）
        return;
      }
      if (closedByUs) return;
      // 連續握手失敗 → 可能 session 過期（401 不升級）：確認後停止重試
      if (!opened && ++consecutiveFails >= 3) {
        try {
          const me = (await (await fetch("/api/me")).json()) as { user: unknown };
          if (!me.user) {
            authLost.value = true;
            return;
          }
        } catch {
          /* 網路問題 → 繼續重試 */
        }
      }
      setTimeout(() => {
        if (!closedByUs) connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
    if (!pingTimer) {
      // readyState 守衛：CONNECTING 時 send 會同步丟 InvalidStateError
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
      }, PING_INTERVAL_MS);
    }
    if (!nowTimer) nowTimer = setInterval(() => (now.value = Date.now()), 500);
  }

  function dispose(): void {
    closedByUs = true;
    clearInterval(pingTimer);
    clearInterval(nowTimer);
    pingTimer = nowTimer = undefined;
    try {
      ws?.close(1000);
    } catch {
      /* ignore */
    }
    ws = null;
  }

  /* ---------- 操作 ---------- */
  function sendJson(payload: unknown): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  /** useBattle onLaunchSubmit 接這個：true = 已送伺服器（composable 不跑本機流程） */
  function submitAim(aim: AimInput): boolean {
    if (snapshot.value?.phase !== "aiming" || myLaunched.value) return true; // 非瞄準/已發射 → 吃掉輸入
    if (!sendJson({ type: "launch", aim })) return true; // 斷線中 → 丟棄（重連後重瞄；不播音效不誤導）
    sentLaunch.value = true;
    playLaunch(); // 真正送出才播發射音效
    return true;
  }

  function sendLoadout(patch: Partial<PlayerLoadout>): void {
    sendJson({ type: "loadout", loadout: patch });
  }

  function nextRound(): void {
    sendJson({ type: "next-round" });
  }

  function rematch(): void {
    sendJson({ type: "rematch" });
  }

  /** 房主關閉房間（DO 驗證：僅 A 側且 waiting 有效）；成功時 DO 會以 4002 關閉本連線 */
  function closeRoom(): void {
    sendJson({ type: "close-room" });
  }

  return {
    // 狀態
    you,
    snapshot,
    lastOutcome,
    connected,
    roomFull,
    superseded,
    authLost,
    roomClosed,
    errorMsg,
    opponentJustLaunched,
    opponentAdvanced,
    me,
    opponent,
    matchArena,
    myLaunched,
    aimRemaining,
    // 接線 / 生命週期
    bind,
    connect,
    dispose,
    // 操作
    submitAim,
    sendLoadout,
    nextRound,
    rematch,
    closeRoom,
  };
}
