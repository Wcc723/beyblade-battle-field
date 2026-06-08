/**
 * 陀螺屬性管理（localStorage）。
 * 預設值來自 src/physics/presets.ts 的 STAT_PRESETS（已校過平衡），
 * 玩家可在「陀螺後台」覆寫，對戰時以此為準。
 */
import { reactive } from "vue";
import type { BeybladeStats } from "../physics/types";
import { STAT_PRESETS } from "../physics/presets";

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
