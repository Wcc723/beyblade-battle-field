/**
 * 線上對戰房：協定型別 + 純函式（發射消毒/伺服器端 init 組裝/預設發射）。
 * 零瀏覽器/Env 相依：Battle Room DO、前端、單元測試三方共用。
 *
 * 安全模型：client 只送「瞄準輸入」AimInput（落點/方向/力道），
 * stats / special / spinDir 等全部由伺服器依玩家 loadout + D1 全域設定組裝
 * → 竄改 payload 不可能買到更強的陀螺。
 */
import type { ArenaConfig, BeybladeInit, BeybladeStats, SpecialConfig, SpecialKind, WinReason } from "../physics/types";
import { DEFAULT_SCALES } from "../physics/engine";

export type Side = "A" | "B";
export const SIDE_COLORS: Record<Side, string> = { A: "#e8442e", B: "#2e9fe8" };

/**
 * 線上對戰旋向固定（不開放調整）：先手 A＝右旋、後手 B＝左旋。
 * 兩顆永遠反向 → 每場都吃引擎的反向對撞加成（oppSpinBonus），對撞更有戲。
 * DO 端是權威（join/loadout/BOT 都強制蓋回）；前端只做顯示。
 */
export function sideSpinDir(side: Side): 1 | -1 {
  return side === "A" ? 1 : -1;
}

/** 玩家配置（伺服器端真相；client 的 loadout 訊息只能改這個） */
export interface PlayerLoadout {
  type: string; // attack | defense | stamina | balance（驗證時對 stats keys）
  spinDir: 1 | -1;
  special: "" | SpecialKind;
}

export interface PublicPlayer {
  uid: number;
  nickname: string;
  picture: string;
  loadout: PlayerLoadout;
  connected: boolean;
  launched: boolean;
  /** 內建 AI 對手（DO 自己操作，不對應任何真實使用者） */
  isBot?: boolean;
}

/** 內建 BOT 的假 uid（不會出現在 users 表） */
export const BOT_UID = -1;
export const BOT_NICKNAME = "陪練 BOT";

/** 房號：6 位、去掉易混淆字元（0/O/1/I/L）。worker 路由與 Lobby DO 共用。 */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function genRoomCode(): string {
  const buf = crypto.getRandomValues(new Uint8Array(6));
  return [...buf].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
}

/** client → server 的瞄準輸入 */
export interface AimInput {
  x: number; // 落點（世界座標）
  y: number;
  dirX: number; // 發射方向（會被正規化）
  dirY: number;
  power: number; // 0~1
}

export type RoomPhase = "waiting" | "aiming" | "review" | "finished";

/** 廣播給兩端的房間快照（個資最小化：只有暱稱/頭像/配置） */
export interface RoomSnapshot {
  phase: RoomPhase;
  roundNum: number;
  scoreA: number;
  scoreB: number;
  players: Partial<Record<Side, PublicPlayer>>;
  /** 瞄準截止（unix ms；伺服器 alarm 到點自動發射） */
  aimDeadline?: number;
  winnerSide?: Side;
  arenaName?: string;
}

export interface RoundOutcome {
  winnerSide: Side | "";
  reason: WinReason; // WinReason 已含 "draw"
  points: number;
  scoreA: number;
  scoreB: number;
  roundNum: number;
  matchOver: boolean;
}

/** 一回合的「重跑包」：兩端用同一份確定性引擎重算 → 不用傳 1.5MB frames */
export interface RoundPayload {
  inits: BeybladeInit[];
  seed: number;
  arena: ArenaConfig;
  special: SpecialConfig;
  maxTime: number;
  followThroughTime: number;
  outcome: RoundOutcome;
}

export type ClientMsg =
  | { type: "loadout"; loadout: Partial<PlayerLoadout> }
  | { type: "launch"; aim: AimInput }
  | { type: "next-round" }
  | { type: "rematch" };

export type ServerMsg =
  | { type: "room"; you: Side; snapshot: RoomSnapshot }
  | { type: "round"; payload: RoundPayload }
  | { type: "opponent-launched" }
  | { type: "error"; code: string };

/* ---------- 大廳協定（Lobby DO ↔ 前端共用；放這裡＝零 Env 相依，前端 import 不會炸） ---------- */

export interface PublicRoom {
  code: string;
  host: string;
  createdAt: number;
}

export type LobbyClientMsg = { type: "queue" } | { type: "unqueue" };

export type LobbyServerMsg =
  | { type: "lobby"; online: number; queueSize: number; queued: boolean; rooms: PublicRoom[] }
  | { type: "matched"; code: string };

/* ---------- 純函式 ---------- */

const AIM_POWER_MIN = 0.06;

function scaleRefOf(arena: ArenaConfig): number {
  return arena.box ? arena.box.half : arena.radius;
}

/**
 * 消毒瞄準輸入：非法/非有限值 → null；落點夾回場內、方向正規化、力道夾 0~1。
 * 與前端 clientToWorld 的 0.9 限制一致。
 */
export function sanitizeAim(aim: AimInput, arena: ArenaConfig): AimInput | null {
  const nums = [aim.x, aim.y, aim.dirX, aim.dirY, aim.power];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const d = Math.hypot(aim.dirX, aim.dirY);
  if (d < 1e-6) return null;
  let { x, y } = aim;
  const lim = scaleRefOf(arena) * 0.9;
  const r = Math.hypot(x, y);
  if (r > lim) {
    x = (x / r) * lim;
    y = (y / r) * lim;
  }
  const power = Math.min(1, Math.max(AIM_POWER_MIN, aim.power));
  return { x, y, dirX: aim.dirX / d, dirY: aim.dirY / d, power };
}

/** 伺服器端組裝 BeybladeInit（與前端 makeInit 同公式 → 手感一致） */
export function buildInitFromAim(
  side: Side,
  loadout: PlayerLoadout,
  stats: BeybladeStats,
  aim: AimInput,
): BeybladeInit {
  const speed = aim.power * DEFAULT_SCALES.maxSpeed;
  const spin = (0.55 + 0.45 * aim.power) * DEFAULT_SCALES.maxSpin;
  return {
    id: side,
    color: SIDE_COLORS[side],
    stats: { ...stats },
    position: { x: aim.x, y: aim.y },
    velocity: { x: aim.dirX * speed, y: aim.dirY * speed },
    spin,
    radius: 26,
    spinDir: loadout.spinDir,
    special: loadout.special || undefined,
  };
}

/** 瞄準逾時的自動發射：靠己方場邊、朝中心、中等力道（確定性，不靠亂數） */
export function defaultAim(side: Side, arena: ArenaConfig): AimInput {
  const lim = scaleRefOf(arena) * 0.55;
  const y = side === "A" ? -lim : lim; // A 下半場、B 上半場（與場地缺口無關，朝中心打）
  return { x: 0, y, dirX: 0, dirY: side === "A" ? 1 : -1, power: 0.6 };
}

/** BOT 隨機發射：落在自己半場、大致朝對面、力道中上（rng 可注入供測試） */
export function randomBotAim(side: Side, arena: ArenaConfig, rng: () => number = Math.random): AimInput {
  const lim = scaleRefOf(arena);
  const dirY = side === "A" ? 1 : -1; // A 下半場往上打、B 上半場往下打
  return {
    x: (rng() - 0.5) * lim * 0.7,
    y: -dirY * lim * (0.35 + rng() * 0.3),
    dirX: (rng() - 0.5) * 0.7,
    dirY,
    power: 0.55 + rng() * 0.4,
  };
}

/** BOT 每回合隨機配置（類型/旋向/必殺技） */
export function randomBotLoadout(validTypes: string[], rng: () => number = Math.random): PlayerLoadout {
  const specials: PlayerLoadout["special"][] = ["", "rush", "blast", "dash", "vortex", "clone"];
  return {
    type: validTypes[Math.floor(rng() * validTypes.length)] ?? "balance",
    spinDir: rng() < 0.5 ? 1 : -1,
    special: specials[Math.floor(rng() * specials.length)] ?? "",
  };
}

/** 驗證 loadout 部分更新（type 對照合法 keys；非法欄位忽略） */
export function mergeLoadout(
  current: PlayerLoadout,
  patch: Partial<PlayerLoadout>,
  validTypes: string[],
): PlayerLoadout {
  const next = { ...current };
  if (typeof patch.type === "string" && validTypes.includes(patch.type)) next.type = patch.type;
  if (patch.spinDir === 1 || patch.spinDir === -1) next.spinDir = patch.spinDir;
  if (
    patch.special === "" ||
    patch.special === "rush" ||
    patch.special === "blast" ||
    patch.special === "dash" ||
    patch.special === "vortex" ||
    patch.special === "clone"
  )
    next.special = patch.special;
  return next;
}
