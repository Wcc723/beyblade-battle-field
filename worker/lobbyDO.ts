/**
 * Lobby Durable Object —— 單一全域大廳（idFromName("global")）。
 *
 * 職責：
 * - presence：大廳頁的 WS 連線（hibernation），廣播線上人數（去重 uid）
 * - 快速配對：排隊湊滿兩人 → 發同一個房號給雙方（matched）→ 各自進房
 * - 公開房間列表：開房時 worker 來註冊；Battle Room 開打/清房時來下架；15 分鐘 TTL 兜底
 *
 * 內部 HTTP 介面（只有 worker / Battle Room DO 會打，外部進不來）：
 * - POST /register-room {code, host}
 * - POST /room-closed {code}
 */
import { DurableObject } from "cloudflare:workers";
import { genRoomCode, type LobbyClientMsg, type LobbyServerMsg, type PublicRoom } from "../src/game/room";

const ROOM_TTL_MS = 15 * 60_000;
const QUEUE_TTL_MS = 10 * 60_000; // 佇列殘留（dirty disconnect / DO 重啟的幽靈 entry）兜底
const MAX_MSG_BYTES = 256;

interface LobbyAttachment {
  uid: number;
  nickname: string;
}

interface QueueEntry {
  uid: number;
  nickname: string;
  since: number;
}

export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // 與 Battle Room 同款事件串列化（防 await 期間交錯的 read-modify-write）
  private serial: Promise<unknown> = Promise.resolve();
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.serial.then(fn, fn);
    this.serial = p.catch(() => {});
    return p;
  }

  private async getQueue(): Promise<QueueEntry[]> {
    return (await this.ctx.storage.get<QueueEntry[]>("queue")) ?? [];
  }
  private async getRooms(): Promise<Record<string, PublicRoom>> {
    return (await this.ctx.storage.get<Record<string, PublicRoom>>("rooms")) ?? {};
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ error: "expected_websocket" }, { status: 426 });
      }
      const userRaw = request.headers.get("X-BB-User");
      if (!userRaw) return Response.json({ error: "missing_user" }, { status: 400 });
      let user: LobbyAttachment;
      try {
        user = JSON.parse(userRaw) as LobbyAttachment;
      } catch {
        return Response.json({ error: "bad_user" }, { status: 400 });
      }
      return this.run(async () => {
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [String(user.uid)]);
        pair[1].serializeAttachment(user);
        await this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0] });
      });
    }

    if (url.pathname === "/register-room" && request.method === "POST") {
      return this.run(async () => {
        const body = (await request.json()) as { code?: string; host?: string };
        if (!body.code || typeof body.code !== "string") return Response.json({ error: "bad_room" }, { status: 400 });
        const rooms = await this.getRooms();
        rooms[body.code] = { code: body.code, host: String(body.host ?? "玩家").slice(0, 20), createdAt: Date.now() };
        await this.ctx.storage.put("rooms", rooms);
        // TTL 鬧鐘：安靜大廳（零事件）也要能下架過期房——broadcast 內的 prune 等不到事件
        await this.ensureCleanupAlarm();
        await this.broadcast();
        return Response.json({ ok: true });
      });
    }

    if (url.pathname === "/room-closed" && request.method === "POST") {
      return this.run(async () => {
        const body = (await request.json()) as { code?: string };
        const rooms = await this.getRooms();
        if (body.code && rooms[body.code]) {
          delete rooms[body.code];
          await this.ctx.storage.put("rooms", rooms);
          await this.broadcast();
        }
        return Response.json({ ok: true });
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    let msg: LobbyClientMsg;
    try {
      msg = JSON.parse(message) as LobbyClientMsg;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as LobbyAttachment | null;
    if (!att) return;
    return this.run(async () => {
      let queue = await this.getQueue();
      if (msg.type === "queue") {
        if (!queue.some((q) => q.uid === att.uid)) {
          queue.push({ uid: att.uid, nickname: att.nickname, since: Date.now() });
        }
        queue = this.tryMatch(queue);
      } else if (msg.type === "unqueue") {
        queue = queue.filter((q) => q.uid !== att.uid);
      }
      await this.ctx.storage.put("queue", queue);
      await this.broadcast();
    });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as LobbyAttachment | null;
    return this.run(async () => {
      // 同 uid 沒有其他連線了 → 退出排隊
      if (att && this.ctx.getWebSockets(String(att.uid)).length === 0) {
        const queue = await this.getQueue();
        const next = queue.filter((q) => q.uid !== att.uid);
        if (next.length !== queue.length) await this.ctx.storage.put("queue", next);
      }
      await this.broadcast();
    });
  }

  /**
   * 佇列湊滿兩人 → 發房號（私人房，不上公開列表）。
   * 先剔除「沒有活連線」的幽靈 entry（dirty disconnect / DO 重啟殘留）——
   * 不剔除的話真人會配到幽靈：matched 發進空氣、進房空等。
   */
  private tryMatch(queue: QueueEntry[]): QueueEntry[] {
    queue = queue.filter((q) => this.ctx.getWebSockets(String(q.uid)).length > 0);
    while (queue.length >= 2) {
      const [a, b] = queue;
      const code = genRoomCode();
      for (const entry of [a, b]) {
        for (const ws of this.ctx.getWebSockets(String(entry.uid))) {
          this.send(ws, { type: "matched", code });
        }
      }
      queue = queue.slice(2);
    }
    return queue;
  }

  /** 排（或提前）一顆清理鬧鐘到「最早到期的公開房」時間點 */
  private async ensureCleanupAlarm(): Promise<void> {
    const rooms = await this.getRooms();
    const earliest = Math.min(...Object.values(rooms).map((r) => r.createdAt + ROOM_TTL_MS));
    if (!Number.isFinite(earliest)) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > earliest) await this.ctx.storage.setAlarm(earliest);
  }

  /** 鬧鐘：prune 過期公開房 + 幽靈佇列 entry，廣播更新；還有房就再排下一顆 */
  override async alarm(): Promise<void> {
    return this.run(async () => {
      const queue = await this.getQueue();
      const fresh = queue.filter(
        (q) => Date.now() - q.since < QUEUE_TTL_MS && this.ctx.getWebSockets(String(q.uid)).length > 0,
      );
      if (fresh.length !== queue.length) await this.ctx.storage.put("queue", fresh);
      await this.broadcast(); // broadcast 內含 rooms TTL prune
      await this.ensureCleanupAlarm();
    });
  }

  private send(ws: WebSocket, msg: LobbyServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private async broadcast(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const uids = new Set<number>();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as LobbyAttachment | null;
      if (att) uids.add(att.uid);
    }
    // 佇列 TTL 兜底（只看時間、不看活性——重連的 1 秒空窗不能誤踢正常排隊者）
    let queue = await this.getQueue();
    const freshQueue = queue.filter((q) => Date.now() - q.since < QUEUE_TTL_MS);
    if (freshQueue.length !== queue.length) {
      await this.ctx.storage.put("queue", freshQueue);
      queue = freshQueue;
    }
    const queuedUids = new Set(queue.map((q) => q.uid));
    // 公開房 TTL 兜底（開了房沒人來、房主又沒正常離開）
    const rooms = await this.getRooms();
    const now = Date.now();
    let pruned = false;
    for (const code of Object.keys(rooms)) {
      if (now - rooms[code].createdAt > ROOM_TTL_MS) {
        delete rooms[code];
        pruned = true;
      }
    }
    if (pruned) await this.ctx.storage.put("rooms", rooms);
    const roomList = Object.values(rooms).sort((a, b) => b.createdAt - a.createdAt);

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as LobbyAttachment | null;
      this.send(ws, {
        type: "lobby",
        online: uids.size,
        queueSize: queue.length,
        queued: att ? queuedUids.has(att.uid) : false,
        rooms: roomList,
      });
    }
  }
}
