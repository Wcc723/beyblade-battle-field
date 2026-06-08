/**
 * 場地預設管理（localStorage）。
 * 之後接 Cloudflare 時，這層可改成讀寫 D1 / Durable Object SQLite，
 * 介面（list / add / update / remove / setActive / getActiveConfig）維持不變。
 */
import { ref } from "vue";
import type { ArenaConfig } from "../physics/types";
import { DEFAULT_ARENA } from "../physics/engine";

export interface ArenaPreset {
  id: string;
  name: string;
  config: ArenaConfig;
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

// 首次使用：種一組預設場地，確保一定有可套用的設定
if (presets.value.length === 0) {
  addPreset("預設場地", DEFAULT_ARENA);
}
