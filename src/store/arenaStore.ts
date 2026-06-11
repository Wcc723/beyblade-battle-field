/**
 * 場地預設管理（localStorage）。
 * 之後接 Cloudflare 時，這層可改成讀寫 D1 / Durable Object SQLite，
 * 介面（list / add / update / remove / setActive / getActiveConfig）維持不變。
 */
import { ref } from "vue";
import type { ArenaConfig } from "../physics/types";
import { DEFAULT_ARENA, XTREME_STADIUM, ARC_WALL_STADIUM } from "../physics/engine";

export interface ArenaPreset {
  id: string;
  name: string;
  config: ArenaConfig;
  /** 是否為內建示範場（程式碼植入）。 */
  builtin?: boolean;
  /** 使用者是否改過此場：改過後內建場就不再被程式碼覆寫（編輯才能正確保存）。 */
  userEdited?: boolean;
}

const KEY = "beyblade.arenas.v1";
const ACTIVE_KEY = "beyblade.activeArena.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.floor(Math.random() * 1e9).toString(36);
  }
}

function loadPresets(): ArenaPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ArenaPreset[];
  } catch {
    /* ignore */
  }
  return [];
}

export const presets = ref<ArenaPreset[]>(loadPresets());
export const activeId = ref<string>(localStorage.getItem(ACTIVE_KEY) ?? "");

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets.value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function setActive(id: string): void {
  activeId.value = id;
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function addPreset(name: string, config: ArenaConfig): ArenaPreset {
  const preset: ArenaPreset = { id: uid(), name: name.trim() || "未命名場地", config: { ...config } };
  presets.value.push(preset);
  persist();
  if (!activeId.value) setActive(preset.id);
  return preset;
}

export function updatePreset(id: string, name: string, config: ArenaConfig): void {
  const p = presets.value.find((x) => x.id === id);
  if (!p) return;
  p.name = name.trim() || p.name;
  p.config = { ...config };
  p.userEdited = true; // 標記使用者改過 → 內建場不再被程式碼覆寫
  persist();
}

export function removePreset(id: string): void {
  presets.value = presets.value.filter((x) => x.id !== id);
  persist();
  if (activeId.value === id) setActive(presets.value[0]?.id ?? "");
}

export function getActivePreset(): ArenaPreset | null {
  return presets.value.find((x) => x.id === activeId.value) ?? presets.value[0] ?? null;
}

export function getActiveConfig(): ArenaConfig {
  const p = getActivePreset();
  return p ? { ...p.config } : { ...DEFAULT_ARENA };
}

export function activePresetName(): string {
  return getActivePreset()?.name ?? "預設場地";
}

/** 內建示範場登錄表（程式碼為來源）。exported：遠端後台的「還原原廠」也用它。 */
export const BUILTINS: { name: string; config: ArenaConfig }[] = [
  { name: "熔核競技場 FORGE CORE STADIUM", config: XTREME_STADIUM },
  { name: "弧壁競技場 ARC WALL STADIUM", config: ARC_WALL_STADIUM },
];

/** 舊顯示名 → 新顯示名（去 IP 改名的一次性遷移；內部識別子不變，只改使用者可見名稱）。 */
const RENAMED_BUILTINS: Record<string, string> = {
  "Beyblade X · Xtreme Stadium": "熔核競技場 FORGE CORE STADIUM",
};

/**
 * 內建場同步（冪等）：
 *  - 不存在 → 新增（標記 builtin）。
 *  - 已存在但「使用者沒改過」→ 用最新程式碼覆寫（未動過的內建場自動跟上 code）。
 *  - 已存在且「使用者改過」(userEdited) → 保留使用者版本、不覆寫 → 編輯能正確保存。
 * 想還原原廠：用 resetBuiltin（或刪除後 reload 會重新植入乾淨版）。
 */
function ensureBuiltin(name: string, config: ArenaConfig): void {
  const existing = presets.value.find((p) => p.name === name);
  if (existing) {
    existing.builtin = true;
    if (!existing.userEdited) {
      existing.config = { ...config };
      persist();
    }
  } else {
    const p = addPreset(name, config);
    p.builtin = true;
    persist();
  }
}

/** 把某個內建場還原成程式碼原廠值（清掉 userEdited，之後又會跟著 code 同步）。 */
export function resetBuiltin(id: string): void {
  const p = presets.value.find((x) => x.id === id);
  if (!p) return;
  const b = BUILTINS.find((x) => x.name === p.name);
  if (!b) return;
  p.config = { ...b.config };
  p.userEdited = false;
  persist();
}

// 首次使用：種一組預設場地，確保一定有可套用的設定
if (presets.value.length === 0) {
  addPreset("預設場地", DEFAULT_ARENA);
}
// 舊存檔的內建場顯示名遷移（保留 id / config / userEdited，只改名 → 不會生出重複場地）
for (const p of presets.value) {
  const renamed = RENAMED_BUILTINS[p.name];
  if (renamed && !presets.value.some((x) => x.name === renamed)) {
    p.name = renamed;
    persist();
  }
}
// 內建示範場（使用者改過的不會被覆寫）
for (const b of BUILTINS) ensureBuiltin(b.name, b.config);
