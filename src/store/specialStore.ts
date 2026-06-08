/**
 * 必殺技數值（集中可調，存 localStorage）。
 * 預設取自引擎 DEFAULT_SPECIAL；對戰時把這組傳進 simulate(config.special)。
 */
import { reactive } from "vue";
import type { SpecialConfig } from "../physics/types";
import { DEFAULT_SPECIAL } from "../physics/engine";

const KEY = "beyblade.special.v2";

function load(): SpecialConfig {
  const base: SpecialConfig = { ...DEFAULT_SPECIAL };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return base;
}

export const special = reactive<SpecialConfig>(load());

export function persistSpecial(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(special));
  } catch {
    /* ignore */
  }
}

export function resetSpecial(): void {
  Object.assign(special, DEFAULT_SPECIAL);
  persistSpecial();
}
