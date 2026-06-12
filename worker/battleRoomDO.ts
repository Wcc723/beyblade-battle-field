/**
 * Battle Room Durable Object —— 線上對戰房的權威狀態機。
 *
 * 流程：waiting（等兩人）→ aiming（雙方並行瞄準，45s 截止自動發射）→
 *       simulate()（DO 端權威運算 + 計分）→ review（兩端各自重跑回放）→
 *       next-round → … → finished（先到 WIN_SCORE）→ rematch。
 *
 * 關鍵設計：
 * - WebSocket Hibernation（acceptWebSocket + webSocketMessage/Close），省成本、斷線重連自然。
 * - client 只送「瞄準輸入」AimInput；stats/special/spinDir 由 DO 依 loadout + D1 全域設定組裝（防竄改）。
 * - seed 在雙方都提交後才用 crypto 產生（不能用 roundNum——可預測 → 可離線暴搜最佳發射參數）。
 * - 收齊前不洩漏對方發射參數：launch 只回 "opponent-launched"，inits 到 round 訊息才一起出現。
 * - 廣播「重跑包」（inits+seed+config ~2KB）而非 frames（~1.5MB）：兩端用同一份確定性引擎重算。
 * - 房間狀態存 ctx.storage（hibernation/DO 重啟都不丟）；全空閒 10 分鐘後清房。
 */
import { DurableObject } from "cloudflare:workers";
import { simulate } from "../src/physics/engine";
import { roundPoints, WIN_SCORE } from "../src/game/scoring";
import {
  sanitizeAim,
  buildInitFromAim,
  defaultAim,
  mergeLoadout,
  randomBotAim,
  randomBotLoadout,
  sideSpinDir,
  BOT_UID,
  BOT_NICKNAME,
  type AimInput,
  type ClientMsg,
  type PlayerLoadout,
  type RoomPhase,
  type RoomSnapshot,
  type RoundPayload,
  type ServerMsg,
  type Side,
} from "../src/game/room";
import { autoNickname } from "../src/game/names";
import { BEYBLADES, getBey, resolveBeyStats, DEFAULT_LINEUP } from "../src/game/beyblades";
import type { ArenaConfig, SpecialKind } from "../src/physics/types";
import { readGameConfig, readLineup, type GameConfig, type LineupEntry } from "./api";

const AIM_MS = 45_000; // 瞄準時限（到點自動以預設參數發射）
const IDLE_CLEANUP_MS = 10 * 60_000; // 全員離線後清房
const MAX_MSG_BYTES = 4096;
const MAX_TIME = 60;
const FOLLOW_THROUGH = 2.5;

interface StoredPlayer {
  uid: number;
  nickname: string;
  picture: string;
  loadout: PlayerLoadout;
  isBot?: boolean;
  /** 出賽陣容（join 時讀 D1、本局凍結）：按順序出賽的輪替表＋in-battle 切換的 allowed 清單 */
  lineup?: LineupEntry[];
  /** 本回合手動切換過陀螺（記回合號）：startAiming 套陣容順序時跳過、只影響當回合 */
  pickedRound?: number;
}

interface StoredRoom {
  phase: RoomPhase;
  roundNum: number;
  scoreA: number;
  scoreB: number;
  players: Partial<Record<Side, StoredPlayer>>;
  aims: Partial<Record<Side, AimInput>>;
  aimDeadline?: number;
  winnerSide?: Side;
  /** BOT 房：哪一側是內建 AI（開房帶 ?bot=1 時自動入座） */
  botSide?: Side;
  /** 房號（DO 不知道自己的 idFromName 名字，join 時由 worker 帶進來）：戰績與大廳通知用 */
  code?: string;
  /** 全員離線起算時戳（清房要確認真的閒置滿 IDLE_CLEANUP_MS，殘留鬧鐘提早到點不可誤刪） */
  idleSince?: number;
  /** 最後一回合的重跑包：重連/錯過廣播的玩家補發（review/finished 時 join 重送） */
  lastRound?: RoundPayload;
  /** 本回合凍結的全域設定：消毒/預設發射/模擬同一份基準（管理員回合中調參不影響進行中回合）。
   *  注意：arena 欄位在 startAiming 已換成 matchArena 的場地（整場 match 同一座）。 */
  roundCfg?: GameConfig;
  /** 本場 match 的場地：round 1 startAiming 時從啟用池隨機抽一座、整場固定（rematch 清掉重抽） */
  matchArena?: { id: string; name: string; config: ArenaConfig };
}

interface WsAttachment {
  uid: number;
  side: Side;
}

/** join 時 worker 路由塞進來的使用者資訊（已驗證 session 後的內部信任 header）。
 *  loadout 仍是舊版「個人設定預設」形狀（type/spinDir/special）：lineup 制下 DO 不再採用
 *  （實際出賽配置由 D1 lineup 決定），保留欄位讓 worker 路由免改、wire 相容。 */
export interface JoinUser {
  uid: number;
  nickname: string;
  picture: string;
  loadout: { type: string; spinDir: 1 | -1; special: "" | SpecialKind };
}

function freshRoom(): StoredRoom {
  return { phase: "waiting", roundNum: 1, scoreA: 0, scoreB: 0, players: {}, aims: {} };
}

export class BattleRoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // client 每 25s 送 "ping" 保活：自動回 "pong"，不喚醒 hibernation
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * 事件串列化（重要）：DO 的 input gate 只在 storage 操作時擋事件，
   * 但 handler 中間 await D1（readGameConfig）時 gate 是開的——
   * 兩位玩家幾乎同時發射會交錯執行「load room → …await D1… → save room」，
   * 後存的把先存的 aim 蓋掉 → 比賽卡死（bot 實測重現過）。
   * 所有會改房間狀態的事件一律排進這條 promise chain 依序跑。
   */
  private serial: Promise<unknown> = Promise.resolve();
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.serial.then(fn, fn);
    this.serial = p.catch(() => {});
    return p;
  }

  /** 全域設定快取 5 秒：縮短 handler 內 await D1 的時間、省查詢 */
  private cfgCache: { cfg: GameConfig; at: number } | null = null;
  private async gameConfig(): Promise<GameConfig> {
    if (this.cfgCache && Date.now() - this.cfgCache.at < 5_000) return this.cfgCache.cfg;
    const cfg = await readGameConfig(this.env);
    this.cfgCache = { cfg, at: Date.now() };
    return cfg;
  }

  private async loadRoom(): Promise<StoredRoom> {
    return (await this.ctx.storage.get<StoredRoom>("room")) ?? freshRoom();
  }
  private async saveRoom(room: StoredRoom): Promise<void> {
    await this.ctx.storage.put("room", room);
  }

  /* ---------- 加入（WS upgrade，由 worker 路由轉發） ---------- */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "expected_websocket" }, { status: 426 });
    }
    const userRaw = request.headers.get("X-BB-User");
    if (!userRaw) return Response.json({ error: "missing_user" }, { status: 400 });
    let user: JoinUser;
    try {
      user = JSON.parse(userRaw) as JoinUser;
    } catch {
      return Response.json({ error: "bad_user" }, { status: 400 });
    }
    const wantBot = request.headers.get("X-BB-Bot") === "1";
    const roomCode = request.headers.get("X-BB-Room") ?? "";
    return this.run(() => this.handleJoin(user, wantBot, roomCode));
  }

  private async handleJoin(user: JoinUser, wantBot: boolean, roomCode: string): Promise<Response> {

    const room = await this.loadRoom();

    // 配位：同 uid 回到原位（重連）；否則補空位；兩位都被別人佔 → 滿房
    let side: Side | null = null;
    if (room.players.A?.uid === user.uid) side = "A";
    else if (room.players.B?.uid === user.uid) side = "B";
    else if (!room.players.A) side = "A";
    else if (!room.players.B) side = "B";
    if (!side) {
      // 滿房：完成 upgrade 再用明確代碼關閉 → client 看得到 4001、不會盲目重連
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].close(4001, "room_full");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // 同一玩家舊連線（另一分頁/斷線殘留）→ 關掉，單一連線為準
    for (const ws of this.ctx.getWebSockets(side)) {
      try {
        ws.close(4000, "superseded");
      } catch {
        /* ignore */
      }
    }

    // 暱稱保險：上游取到空值（user_settings 空白等）→ fallback 系統代號（只顯示用，不寫 DB）
    const nickname = (user.nickname ?? "").trim() || autoNickname(user.uid);
    const existing = room.players[side];
    if (existing?.uid === user.uid) {
      // 重連：保留本局 loadout / lineup（陣容本場凍結，輪替順序不被中途改設定打亂）
      room.players[side] = { ...existing, nickname, picture: user.picture };
    } else {
      // 新入座：讀玩家出賽陣容（D1 失敗/壞資料 → DEFAULT_LINEUP），第一棒先上場
      // （這裡在 run() 串列裡 await D1 是安全的——所有改狀態事件都排同一條 chain）
      const lineup = await readLineup(this.env, user.uid);
      room.players[side] = {
        uid: user.uid,
        nickname,
        picture: user.picture,
        lineup,
        // 旋向固定：先手 A 右旋、後手 B 左旋（個人設定的預設旋向在線上無效）
        loadout: {
          beyId: lineup[0].beyId,
          spinDir: sideSpinDir(side),
          special: lineup[0].special as PlayerLoadout["special"],
        },
      };
    }

    // BOT 房：另一側還空著 → 讓內建 AI 入座（配置 startAiming 每回合重抽，這裡先佔位）
    if (wantBot) {
      const other: Side = side === "A" ? "B" : "A";
      if (!room.players[other]) {
        room.players[other] = {
          uid: BOT_UID,
          nickname: BOT_NICKNAME,
          picture: "",
          loadout: { ...randomBotLoadout(), spinDir: sideSpinDir(other) },
          isBot: true,
        };
        room.botSide = other;
      }
    }

    room.code ||= roomCode;
    // 兩人到齊且還在等人 → 開始瞄準（房間開打 → 通知大廳下架公開列表）
    if (room.phase === "waiting" && room.players.A && room.players.B) {
      await this.startAiming(room);
      await this.notifyLobbyClosed(room.code);
    }
    room.idleSince = undefined; // 有人在房裡
    await this.saveRoom(room);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [side]);
    server.serializeAttachment({ uid: user.uid, side } satisfies WsAttachment);

    await this.broadcastRoom(room);
    // 重連/錯過廣播：review/finished 補發最後一回合的重跑包（讓他看得到回放與結果）
    if ((room.phase === "review" || room.phase === "finished") && room.lastRound) {
      this.send(server, { type: "round", payload: room.lastRound });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- 訊息 ---------- */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att) return;
    return this.run(() => this.handleMessage(ws, msg, att));
  }

  private async handleMessage(ws: WebSocket, msg: ClientMsg, att: WsAttachment): Promise<void> {
    const room = await this.loadRoom();
    const me = room.players[att.side];
    if (!me || me.uid !== att.uid) return; // 殭屍連線（位子已被重佔）

    switch (msg.type) {
      case "loadout": {
        // 發射前都可改配置（waiting / aiming 未發射）；beyId 只能在自己的 lineup 內挑
        if ((room.phase === "waiting" || room.phase === "aiming") && !room.aims[att.side]) {
          const allowed = (me.lineup?.length ? me.lineup : DEFAULT_LINEUP).map((e) => e.beyId);
          me.loadout = mergeLoadout(me.loadout, msg.loadout ?? {}, allowed);
          me.loadout.spinDir = sideSpinDir(att.side); // 旋向固定，client 改不動
          // 手動切換陀螺只影響當回合：記回合號，startAiming 套陣容輪替時跳過這位玩家
          if (typeof msg.loadout?.beyId === "string" && allowed.includes(msg.loadout.beyId)) {
            me.pickedRound = room.roundNum;
          }
          await this.saveRoom(room);
          await this.broadcastRoom(room);
        }
        return;
      }
      case "launch": {
        if (room.phase !== "aiming" || room.aims[att.side]) return; // 非瞄準階段 / 已發射過 → 忽略
        // 回合凍結的設定：雙方消毒基準一致，管理員回合中調參不影響進行中回合
        const cfg = room.roundCfg ?? (await this.gameConfig());
        const aim = sanitizeAim(msg.aim, cfg.arena);
        if (!aim) {
          this.send(ws, { type: "error", code: "bad_aim" });
          return;
        }
        room.aims[att.side] = aim;
        await this.saveRoom(room);
        // 不洩漏參數：只告知「對手已發射」
        const other: Side = att.side === "A" ? "B" : "A";
        for (const ows of this.ctx.getWebSockets(other)) this.send(ows, { type: "opponent-launched" });
        await this.broadcastRoom(room);
        if (room.aims.A && room.aims.B) await this.runRound(room);
        return;
      }
      case "next-round": {
        if (room.phase !== "review") return;
        room.roundNum++;
        await this.startAiming(room);
        await this.saveRoom(room);
        await this.broadcastRoom(room);
        return;
      }
      case "rematch": {
        if (room.phase !== "finished") return;
        room.scoreA = 0;
        room.scoreB = 0;
        room.roundNum = 1;
        room.winnerSide = undefined;
        room.matchArena = undefined; // 新一場 match → 場地池重抽
        for (const s of ["A", "B"] as const) {
          const p = room.players[s];
          if (p) p.pickedRound = undefined; // 上一場的手動切換紀錄不可帶進新 match 的 round 1
        }
        await this.startAiming(room);
        await this.saveRoom(room);
        await this.broadcastRoom(room);
        return;
      }
    }
  }

  override async webSocketClose(_ws: WebSocket): Promise<void> {
    return this.run(async () => {
      const room = await this.loadRoom();
      // 全員離線 → 記下閒置起點，並確保有鬧鐘會來檢查清房
      if (this.ctx.getWebSockets().length === 0) {
        room.idleSince = Date.now();
        await this.saveRoom(room);
        const current = await this.ctx.storage.getAlarm();
        if (current === null) await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
      }
      await this.broadcastRoom(room); // connected 旗標更新
    });
  }

  /* ---------- 鬧鐘：瞄準逾時自動發射 / 空房清理 ---------- */
  override async alarm(): Promise<void> {
    return this.run(() => this.handleAlarm());
  }

  private async handleAlarm(): Promise<void> {
    const room = await this.loadRoom();
    if (room.phase === "aiming" && room.aimDeadline && Date.now() >= room.aimDeadline) {
      const cfg = room.roundCfg ?? (await this.gameConfig());
      if (!room.aims.A) room.aims.A = defaultAim("A", cfg.arena);
      if (!room.aims.B) room.aims.B = defaultAim("B", cfg.arena);
      await this.saveRoom(room);
      await this.runRound(room); // runRound 會清掉瞄準鬧鐘、必要時補排清房鬧鐘
      return;
    }
    // 清房：必須確認真的閒置滿 IDLE_CLEANUP_MS——殘留的瞄準鬧鐘提早到點不可誤刪
    // （否則 review/finished 階段雙方短暫斷線，比分/座位幾秒內就被清掉）
    if (this.ctx.getWebSockets().length === 0) {
      const since = room.idleSince ?? Date.now();
      if (Date.now() - since >= IDLE_CLEANUP_MS) {
        await this.ctx.storage.deleteAll(); // 連 alarm 一起清
        await this.notifyLobbyClosed(room.code); // 公開房開了沒人來就棄置 → 下架
      } else {
        if (room.idleSince === undefined) {
          room.idleSince = since;
          await this.saveRoom(room);
        }
        await this.ctx.storage.setAlarm(since + IDLE_CLEANUP_MS);
      }
    }
  }

  /* ---------- 內部 ---------- */
  private async startAiming(room: StoredRoom): Promise<void> {
    room.phase = "aiming";
    room.aims = {};
    room.aimDeadline = Date.now() + AIM_MS;
    const cfg = await this.gameConfig();
    // 場地隨機池：match 開始（round 1 / rematch 清空後）從啟用池抽一座、整場 match 固定。
    // DO 層用真亂數沒問題——場地選擇不進引擎，確定性重跑不受影響。
    if (!room.matchArena) {
      const pool = cfg.arenas;
      const idx = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
      room.matchArena = { id: pool[idx].id, name: pool[idx].name, config: { ...pool[idx].config } };
    }
    // 凍結本回合的全域設定：消毒/預設發射/模擬同一份基準；
    // arena 換成 matchArena → 下游（sanitizeAim/defaultAim/simulate/重跑包）全吃同一座場地
    room.roundCfg = { ...cfg, arena: { ...room.matchArena.config }, arenaName: room.matchArena.name };
    // 按順序出賽：本回合沒手動切換的玩家 → 陣容第 (roundNum-1) % len 棒上場（special 跟著陣容格）
    for (const s of ["A", "B"] as const) {
      const p = room.players[s];
      if (!p || p.isBot || p.pickedRound === room.roundNum) continue;
      const lineup = p.lineup?.length ? p.lineup : DEFAULT_LINEUP;
      const entry = lineup[(room.roundNum - 1) % lineup.length];
      p.loadout.beyId = entry.beyId;
      p.loadout.special = entry.special as PlayerLoadout["special"];
    }
    // BOT：每回合隨機配置 + 開局即提交隱藏 aim（不洩漏——aims 從不廣播，
    // 玩家只看得到 launched=✓；零計時器、hibernation 也不怕）
    const bot = room.botSide ? room.players[room.botSide] : undefined;
    if (room.botSide && bot?.isBot) {
      bot.loadout = { ...randomBotLoadout(), spinDir: sideSpinDir(room.botSide) };
      const aim = sanitizeAim(randomBotAim(room.botSide, room.roundCfg.arena), room.roundCfg.arena);
      room.aims[room.botSide] = aim ?? defaultAim(room.botSide, room.roundCfg.arena);
    }
    void this.ctx.storage.setAlarm(room.aimDeadline);
  }

  /** 雙方輸入到齊：權威模擬 + 計分 + 廣播重跑包 */
  private async runRound(room: StoredRoom): Promise<void> {
    const cfg = room.roundCfg ?? (await this.gameConfig());
    const sides: Side[] = ["A", "B"];
    const inits = sides.map((s) => {
      const p = room.players[s]!;
      // beyId → 名冊個體差 × 類型基礎屬性（client 只送 beyId/special，數值全由伺服器組裝 → 防竄改）
      const bey = getBey(p.loadout.beyId) ?? BEYBLADES[0];
      const base = cfg.stats[bey.type] ?? cfg.stats.balance;
      return buildInitFromAim(s, p.loadout, resolveBeyStats(bey, base), room.aims[s]!);
    });
    // seed：雙方提交後才產生（防離線暴搜）
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];

    const result = simulate(inits, {
      dt: 1 / 60,
      maxTime: MAX_TIME,
      arena: { ...cfg.arena },
      seed,
      sampleEvery: 100000, // DO 端只要勝負，不需要軌跡（frames 由兩端自己重跑）
      followThroughTime: FOLLOW_THROUGH,
      special: { ...cfg.special },
    });

    const points = roundPoints(cfg.arena, result);
    const winnerSide = (result.winnerId ?? "") as Side | "";
    if (winnerSide === "A") room.scoreA += points;
    else if (winnerSide === "B") room.scoreB += points;
    const matchOver = room.scoreA >= WIN_SCORE || room.scoreB >= WIN_SCORE;
    room.phase = matchOver ? "finished" : "review";
    room.winnerSide = matchOver ? (room.scoreA >= WIN_SCORE ? "A" : "B") : undefined;
    room.aimDeadline = undefined;

    const payload: RoundPayload = {
      inits,
      seed,
      arena: cfg.arena,
      special: cfg.special,
      maxTime: MAX_TIME,
      followThroughTime: FOLLOW_THROUGH,
      outcome: {
        winnerSide,
        reason: result.reason,
        points,
        scoreA: room.scoreA,
        scoreB: room.scoreB,
        roundNum: room.roundNum,
        matchOver,
      },
    };
    room.lastRound = payload; // 落地：重連/錯過廣播的玩家 join 時補發
    if (this.ctx.getWebSockets().length === 0) room.idleSince ??= Date.now();
    await this.saveRoom(room);

    // 比賽結束 → 寫一筆戰績到 D1（失敗不擋遊戲流程）
    if (matchOver && room.players.A && room.players.B && room.winnerSide) {
      const a = room.players.A;
      const b = room.players.B;
      try {
        await this.env.DB.prepare(
          `INSERT INTO matches (room_code, a_uid, b_uid, a_nickname, b_nickname, score_a, score_b, winner_side, vs_bot)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
          .bind(
            room.code ?? "",
            a.isBot ? null : a.uid,
            b.isBot ? null : b.uid,
            a.nickname,
            b.nickname,
            room.scoreA,
            room.scoreB,
            room.winnerSide,
            a.isBot || b.isBot ? 1 : 0,
          )
          .run();
      } catch (err) {
        console.error("match insert failed", err);
      }
    }

    // 瞄準鬧鐘任務已了——清掉殘留鬧鐘（不清的話 review/finished 階段它到點會誤觸清房檢查，
    // 把全員短暫離線的寬限從 10 分鐘縮成幾秒）；房裡沒人才補排清房鬧鐘
    await this.ctx.storage.deleteAlarm();
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
    }

    this.broadcastAll({ type: "round", payload });
    await this.broadcastRoom(room);
  }

  /** 通知大廳把這個房號從公開列表下架（房間開打 / 被清掉）；大廳掛了不擋遊戲。 */
  private async notifyLobbyClosed(code: string | undefined): Promise<void> {
    if (!code) return;
    try {
      const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName("global"));
      await stub.fetch("https://lobby/room-closed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch (err) {
      console.error("lobby notify failed", err);
    }
  }

  private snapshotOf(room: StoredRoom, arenaName?: string): RoomSnapshot {
    const connected = (side: Side) => this.ctx.getWebSockets(side).length > 0;
    const pub = (side: Side) => {
      const p = room.players[side];
      if (!p) return undefined;
      return {
        uid: p.uid,
        nickname: p.nickname,
        picture: p.picture,
        loadout: p.loadout,
        connected: p.isBot ? true : connected(side), // BOT 沒有 WS，恆在線
        launched: !!room.aims[side],
        isBot: p.isBot,
      };
    };
    return {
      phase: room.phase,
      roundNum: room.roundNum,
      scoreA: room.scoreA,
      scoreB: room.scoreB,
      players: { A: pub("A"), B: pub("B") },
      aimDeadline: room.aimDeadline,
      winnerSide: room.winnerSide,
      arenaName,
      arenaId: room.matchArena?.id,
    };
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 連線已死，close handler 會處理 */
    }
  }

  private broadcastAll(msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  /** 房間快照逐連線送（每人帶自己的 side） */
  private async broadcastRoom(room: StoredRoom): Promise<void> {
    // match 已抽場地 → 用 matchArena（整場固定）；還沒開打（waiting）才退回全域設定的名字
    let arenaName: string | undefined = room.matchArena?.name;
    if (!arenaName) {
      try {
        arenaName = (await this.gameConfig()).arenaName;
      } catch {
        /* 設定讀取失敗不擋廣播 */
      }
    }
    const snapshot = this.snapshotOf(room, arenaName);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (!att) continue;
      this.send(ws, { type: "room", you: att.side, snapshot });
    }
  }
}
