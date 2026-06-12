/**
 * 陀螺屬性管理（localStorage）。
 * 預設值來自 src/physics/presets.ts 的 STAT_PRESETS（已校過平衡），
 * 玩家可在「陀螺後台」覆寫，對戰時以此為準。
 */
import { reactive } from "vue";
import type { BeybladeStats } from "../physics/types";
import { STAT_PRESETS } from "../physics/presets";
import { BEYBLADES, getBey, type BeyDef } from "../game/beyblades";

const KEY = "beyblade.stats.v1";
type StatMap = Record<string, BeybladeStats>;

function loadStats(): StatMap {
  const base: StatMap = {};
  for (const k of Object.keys(STAT_PRESETS)) base[k] = { ...STAT_PRESETS[k] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as StatMap;
      for (const k of Object.keys(base)) {
        if (saved[k]) base[k] = { ...base[k], ...saved[k] };
      }
    }
  } catch {
    /* ignore */
  }
  return base;
}

export const stats = reactive<StatMap>(loadStats());

export function persistStats(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

/** 對戰時取用（回傳複本，避免外部誤改） */
export function getStats(key: string): BeybladeStats {
  return stats[key] ? { ...stats[key] } : { ...STAT_PRESETS[key] };
}

export function resetStat(key: string): void {
  if (STAT_PRESETS[key]) {
    stats[key] = { ...STAT_PRESETS[key] };
    persistStats();
  }
}

export function resetAllStats(): void {
  for (const k of Object.keys(STAT_PRESETS)) stats[k] = { ...STAT_PRESETS[k] };
  persistStats();
}

/* ---------- 陀螺個體調整（10 顆名冊各自的 mods/crit/specialPower 覆寫） ----------
 * 形狀對齊 worker/api.ts 的 BeysValue（前端不可 import worker 模組——root tsconfig 無 workers 型別），
 * 後台存「鋪滿全欄」的整包（與名冊預設相同＝等同未覆寫；夾制在 worker applyBeyOverrides 做）。 */

/** 單顆個體調整（後台編輯用：全欄必填、永遠鋪滿——v-model 直接綁，不用判空） */
export interface BeyTuning {
  mods: { attack: number; defense: number; stamina: number; weight: number };
  crit: number;
  specialPower: number;
}

/** 名冊預設值 → 鋪滿的 BeyTuning（mods 缺欄＝1） */
export function defaultBeyTuning(bey: BeyDef): BeyTuning {
  return {
    mods: {
      attack: bey.mods.attack ?? 1,
      defense: bey.mods.defense ?? 1,
      stamina: bey.mods.stamina ?? 1,
      weight: bey.mods.weight ?? 1,
    },
    crit: bey.crit,
    specialPower: bey.specialPower,
  };
}

/** 鋪名冊預設底再蓋存檔值（存檔缺欄不會讓 UI render 炸掉——同 stats 的合併預設慣例） */
export function mergeBeyTuning(bey: BeyDef, saved?: Partial<BeyTuning> | null): BeyTuning {
  const d = defaultBeyTuning(bey);
  if (!saved || typeof saved !== "object") return d;
  return {
    mods: { ...d.mods, ...(typeof saved.mods === "object" && saved.mods ? saved.mods : {}) },
    crit: typeof saved.crit === "number" ? saved.crit : d.crit,
    specialPower: typeof saved.specialPower === "number" ? saved.specialPower : d.specialPower,
  };
}

const BEYS_KEY = "beyblade.beys.v1";

function loadBeys(): Record<string, BeyTuning> {
  let saved: Record<string, Partial<BeyTuning>> = {};
  try {
    const raw = localStorage.getItem(BEYS_KEY);
    if (raw) saved = JSON.parse(raw) as Record<string, Partial<BeyTuning>>;
  } catch {
    /* ignore */
  }
  const out: Record<string, BeyTuning> = {};
  for (const b of BEYBLADES) out[b.id] = mergeBeyTuning(b, saved[b.id]);
  return out;
}

export const beys = reactive<Record<string, BeyTuning>>(loadBeys());

export function persistBeys(): void {
  try {
    localStorage.setItem(BEYS_KEY, JSON.stringify(beys));
  } catch {
    /* ignore */
  }
}

export function resetBey(beyId: string): void {
  const bey = getBey(beyId);
  if (!bey) return;
  beys[beyId] = defaultBeyTuning(bey);
  persistBeys();
}
