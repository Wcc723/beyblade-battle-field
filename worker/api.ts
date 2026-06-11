/**
 * 遊戲設定 API（Phase 3）。
 *
 * 全域設定（global_config，key-value JSON blob）：
 * - GET /api/config                → 登入即可讀（線上對戰用的場地/屬性/必殺技）
 * - PUT /api/admin/config/:key     → 管理員寫（key ∈ arena | stats | special）
 *
 * 個人設定（user_settings）：
 * - GET /api/settings              → 自己的設定（無資料時回預設值，暱稱取 Google 名）
 * - PUT /api/settings              → upsert 自己的設定
 *
 * D1 沒資料時 GET /api/config 回「程式碼預設值」（不落地寫入——
 * 單一真相在 code，管理員第一次儲存才寫進 D1）。
 */
import type { SessionData } from "./session";
import type { ArenaConfig, BeybladeStats, SpecialConfig } from "../src/physics/types";
import { DEFAULT_ARENA, XTREME_STADIUM, DEFAULT_SPECIAL } from "../src/physics/engine";
import { STAT_PRESETS } from "../src/physics/presets";
import { autoNickname } from "../src/game/names";

export const CONFIG_KEYS = ["arena", "stats", "special"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** 程式碼預設值（D1 空白時的 fallback；id 固定讓前後端對得上） */
function defaultConfigValue(key: ConfigKey): unknown {
  switch (key) {
    case "arena":
      return {
        presets: [
          { id: "default", name: "預設場地", config: { ...DEFAULT_ARENA } },
          { id: "builtin-xtreme", name: "Beyblade X · Xtreme Stadium", config: { ...XTREME_STADIUM }, builtin: true },
        ],
        // 預設啟用 Xtreme（正式對戰現役場地）：migration 0004 清除 D1 blob 後回落到這裡，
        // 若預設是圓形場會讓正式站默默換場。
        activeId: "builtin-xtreme",
      };
    case "stats":
      return Object.fromEntries(Object.entries(STAT_PRESETS).map(([k, v]) => [k, { ...v }]));
    case "special":
      return { ...DEFAULT_SPECIAL };
  }
}

async function readConfig(env: Env, key: ConfigKey): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM global_config WHERE key = ?1").bind(key).first<{
    value: string;
  }>();
  if (!row) return defaultConfigValue(key);
  try {
    return JSON.parse(row.value);
  } catch {
    return defaultConfigValue(key);
  }
}

/** Battle Room DO 用：取「目前線上對戰生效」的整組設定（active 場地 + 屬性 + 必殺技）。 */
export interface GameConfig {
  arena: ArenaConfig;
  arenaName: string;
  stats: Record<string, BeybladeStats>;
  special: SpecialConfig;
}

export async function readGameConfig(env: Env): Promise<GameConfig> {
  const [arenaVal, stats, special] = await Promise.all([
    readConfig(env, "arena") as Promise<{ presets: { id: string; name: string; config: ArenaConfig }[]; activeId: string }>,
    readConfig(env, "stats") as Promise<Record<string, BeybladeStats>>,
    readConfig(env, "special") as Promise<SpecialConfig>,
  ]);
  const preset = arenaVal.presets.find((p) => p.id === arenaVal.activeId) ?? arenaVal.presets[0];
  // stats / special 鋪程式碼預設底（D1 blob 缺欄位不會讓模擬吃到 undefined）
  const mergedStats: Record<string, BeybladeStats> = {};
  for (const [k, v] of Object.entries(STAT_PRESETS)) mergedStats[k] = { ...v, ...(stats[k] ?? {}) };
  return {
    arena: { ...preset.config },
    arenaName: preset.name,
    stats: mergedStats,
    special: { ...DEFAULT_SPECIAL, ...special },
  };
}

export async function handleGetConfig(env: Env): Promise<Response> {
  const [arena, stats, special] = await Promise.all([
    readConfig(env, "arena"),
    readConfig(env, "stats"),
    readConfig(env, "special"),
  ]);
  return Response.json({ arena, stats, special });
}

/** 輕量 shape 驗證：擋掉明顯壞資料，不做全欄位 schema。 */
function isValidConfigValue(key: ConfigKey, value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (key === "arena") {
    const v = value as { presets?: unknown; activeId?: unknown };
    return (
      Array.isArray(v.presets) &&
      v.presets.length > 0 &&
      v.presets.every(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { id?: unknown }).id === "string" &&
          typeof (p as { name?: unknown }).name === "string" &&
          typeof (p as { config?: unknown }).config === "object",
      ) &&
      typeof v.activeId === "string"
    );
  }
  return true; // stats / special：物件即可（欄位由前端 UI 控制）
}

export async function handlePutAdminConfig(request: Request, env: Env, key: string): Promise<Response> {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    return Response.json({ error: "unknown_config_key" }, { status: 404 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isValidConfigValue(key as ConfigKey, value)) {
    return Response.json({ error: "invalid_config_shape" }, { status: 400 });
  }
  await env.DB.prepare(
    `INSERT INTO global_config (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, JSON.stringify(value))
    .run();
  return Response.json({ ok: true });
}

// --- 個人設定 ---

export interface UserSettings {
  nickname: string;
  defaultType: string;
  defaultSpin: string;
  defaultSpecial: string;
  launchMode: string;
  sfx: boolean;
  replaySpeed: number;
}

const TYPES = ["attack", "defense", "stamina", "balance"];
const SPINS = ["right", "left"];
const SPECIALS = ["", "rush", "blast", "dash", "vortex", "clone"];
const LAUNCH_MODES = ["flick", "sling"];

export async function handleGetSettings(env: Env, session: SessionData): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT nickname, default_type, default_spin, default_special, launch_mode, sfx, replay_speed
     FROM user_settings WHERE user_id = ?1`,
  )
    .bind(session.uid)
    .first<{
      nickname: string;
      default_type: string;
      default_spin: string;
      default_special: string;
      launch_mode: string;
      sfx: number;
      replay_speed: number;
    }>();
  // 暱稱為空（新用戶或從未改名）→ 指派系統代號並持久化寫回：之後回傳的 nickname 永遠非空
  let nickname = (row?.nickname ?? "").trim();
  if (!nickname) {
    nickname = autoNickname(session.uid);
    try {
      await env.DB.prepare(
        `INSERT INTO user_settings (user_id, nickname, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at`,
      )
        .bind(session.uid, nickname)
        .run();
    } catch (err) {
      // session 指向已刪除的 user（FK 失敗）→ 視為 session 失效，不是伺服器錯誤（與 PUT 同一道防線）
      if (String(err).includes("FOREIGN KEY")) {
        return Response.json({ error: "session_user_missing" }, { status: 401 });
      }
      // 其他寫入失敗不擋讀取：本次仍回自動代號，下次 GET 會再補寫
      console.error("auto nickname persist failed", err);
    }
  }
  const settings: UserSettings = row
    ? {
        nickname,
        defaultType: row.default_type,
        defaultSpin: row.default_spin,
        defaultSpecial: row.default_special,
        launchMode: row.launch_mode,
        sfx: !!row.sfx,
        replaySpeed: row.replay_speed,
      }
    : {
        nickname,
        defaultType: "balance",
        defaultSpin: "right",
        defaultSpecial: "",
        launchMode: "sling",
        sfx: true,
        replaySpeed: 2,
      };
  return Response.json({ settings, user: { email: session.email, name: session.name, picture: session.picture } });
}

/** 個人戰績：勝敗統計 + 近期對戰（finished 場次才入庫，必有勝者） */
export async function handleGetMatches(env: Env, session: SessionData): Promise<Response> {
  const uid = session.uid;
  const [agg, rows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN (winner_side = 'A' AND a_uid = ?1) OR (winner_side = 'B' AND b_uid = ?1) THEN 1 ELSE 0 END) AS wins
       FROM matches WHERE a_uid = ?1 OR b_uid = ?1`,
    )
      .bind(uid)
      .first<{ total: number; wins: number | null }>(),
    env.DB.prepare(
      `SELECT a_uid, b_uid, a_nickname, b_nickname, score_a, score_b, winner_side, vs_bot, finished_at
       FROM matches WHERE a_uid = ?1 OR b_uid = ?1 ORDER BY id DESC LIMIT 20`,
    )
      .bind(uid)
      .all<{
        a_uid: number | null;
        b_uid: number | null;
        a_nickname: string;
        b_nickname: string;
        score_a: number;
        score_b: number;
        winner_side: string;
        vs_bot: number;
        finished_at: string;
      }>(),
  ]);
  const total = agg?.total ?? 0;
  const wins = agg?.wins ?? 0;
  const matches = (rows.results ?? []).map((m) => {
    const mySide = m.a_uid === uid ? "A" : "B";
    return {
      opponent: mySide === "A" ? m.b_nickname : m.a_nickname,
      myScore: mySide === "A" ? m.score_a : m.score_b,
      oppScore: mySide === "A" ? m.score_b : m.score_a,
      won: m.winner_side === mySide,
      vsBot: !!m.vs_bot,
      finishedAt: m.finished_at,
    };
  });
  return Response.json({ total, wins, losses: total - wins, matches });
}

export async function handlePutSettings(request: Request, env: Env, session: SessionData): Promise<Response> {
  let body: Partial<UserSettings>;
  try {
    body = (await request.json()) as Partial<UserSettings>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const nickname = String(body.nickname ?? "").trim().slice(0, 20);
  const defaultType = TYPES.includes(body.defaultType as string) ? (body.defaultType as string) : "balance";
  const defaultSpin = SPINS.includes(body.defaultSpin as string) ? (body.defaultSpin as string) : "right";
  const defaultSpecial = SPECIALS.includes(body.defaultSpecial as string) ? (body.defaultSpecial as string) : "";
  const launchMode = LAUNCH_MODES.includes(body.launchMode as string) ? (body.launchMode as string) : "sling";
  const sfx = body.sfx === undefined ? true : !!body.sfx;
  const replaySpeed = [1, 2, 3].includes(Number(body.replaySpeed)) ? Number(body.replaySpeed) : 2;
  if (!nickname) return Response.json({ error: "nickname_required" }, { status: 400 });

  try {
    await env.DB.prepare(
      `INSERT INTO user_settings (user_id, nickname, default_type, default_spin, default_special, launch_mode, sfx, replay_speed, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         nickname = excluded.nickname,
         default_type = excluded.default_type,
         default_spin = excluded.default_spin,
         default_special = excluded.default_special,
         launch_mode = excluded.launch_mode,
         sfx = excluded.sfx,
         replay_speed = excluded.replay_speed,
         updated_at = excluded.updated_at`,
    )
      .bind(session.uid, nickname, defaultType, defaultSpin, defaultSpecial, launchMode, sfx ? 1 : 0, replaySpeed)
      .run();
  } catch (err) {
    // session 指向已刪除的 user（FK 失敗）→ 視為 session 失效，不是伺服器錯誤
    if (String(err).includes("FOREIGN KEY")) {
      return Response.json({ error: "session_user_missing" }, { status: 401 });
    }
    console.error("user_settings upsert failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
