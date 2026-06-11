/**
 * 大廳 WS 客戶端：線上人數 / 快速配對 / 公開房間列表（連 Lobby DO）。
 * matched 訊息 → matchedCode 設值，由 LobbyView watch 後跳房。
 */
import { ref } from "vue";
import type { LobbyServerMsg, PublicRoom } from "../game/room";

const PING_INTERVAL_MS = 25_000;
const RETRY_MAX_MS = 10_000;

export function useLobby() {
  const connected = ref(false);
  const online = ref(0);
  const queueSize = ref(0);
  const queued = ref(false);
  const rooms = ref<PublicRoom[]>([]);
  const matchedCode = ref("");
  const authLost = ref(false); // session 失效：停止重連、提示重新登入

  let ws: WebSocket | null = null;
  let closedByUs = false;
  let retryMs = 1000;
  let consecutiveFails = 0; // 連續「沒 open 過就 close」次數（session 失效偵測）
  let wantQueue = false; // 使用者的排隊意圖：斷線重連後自動補排（伺服器斷線會踢出佇列）
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  function onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== "string" || ev.data === "pong") return;
    let msg: LobbyServerMsg;
    try {
      msg = JSON.parse(ev.data) as LobbyServerMsg;
    } catch {
      return;
    }
    if (msg.type === "lobby") {
      online.value = msg.online;
      queueSize.value = msg.queueSize;
      queued.value = msg.queued;
      rooms.value = msg.rooms;
    } else if (msg.type === "matched") {
      wantQueue = false; // 配到了：之後回大廳不要自動再排
      matchedCode.value = msg.code;
    }
  }

  function connect(): void {
    closedByUs = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/api/lobby/ws`);
    let opened = false;
    ws.onopen = () => {
      opened = true;
      consecutiveFails = 0;
      connected.value = true;
      retryMs = 1000;
      if (wantQueue) sendJson({ type: "queue" }); // 斷線時被伺服器踢出佇列 → 自動補排
    };
    ws.onmessage = onMessage;
    ws.onclose = async () => {
      connected.value = false;
      queued.value = false;
      ws = null;
      if (closedByUs) return;
      // 連續握手失敗 → 很可能是 session 過期（401 不升級）：確認後停止重試，別無限打 401
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
  }

  function dispose(): void {
    closedByUs = true;
    clearInterval(pingTimer);
    pingTimer = undefined;
    try {
      ws?.close(1000);
    } catch {
      /* ignore */
    }
    ws = null;
  }

  function sendJson(payload: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
  function enqueue(): void {
    wantQueue = true;
    sendJson({ type: "queue" });
  }
  function unqueue(): void {
    wantQueue = false;
    sendJson({ type: "unqueue" });
  }

  return { connected, online, queueSize, queued, rooms, matchedCode, authLost, connect, dispose, enqueue, unqueue };
}
