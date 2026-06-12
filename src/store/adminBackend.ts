/**
 * 後台「資料源」抽象（Phase 3）：同一份後台 UI，兩種儲存後端——
 * - local：localStorage（測試頁 /test/* 對戰實際吃的那份，沿用既有 store 模組）
 * - remote：D1 全域設定（線上對戰用；透過 /api/config 讀、/api/admin/config/:key 寫）
 *
 * 遠端寫入用 debounce（滑桿 @input 連發不能每下都打 API）。
 */
import { reactive, ref, type Ref } from "vue";
import type { ArenaConfig, BeybladeStats, SpecialConfig } from "../physics/types";
import { DEFAULT_SPECIAL } from "../physics/engine";
import { STAT_PRESETS } from "../physics/presets";
import type { ArenaConfigBlob, ArenaPreset } from "./arenaStore";
import * as localArena from "./arenaStore";
import {
  stats as localStats,
  persistStats,
  resetStat,
  resetAllStats,
  beys as localBeys,
  persistBeys,
  resetBey,
  defaultBeyTuning,
  mergeBeyTuning,
  type BeyTuning,
} from "./statStore";
import { special as localSpecial, persistSpecial, resetSpecial } from "./specialStore";
import { BEYBLADES, getBey } from "../game/beyblades";

export interface ArenaStoreApi {
  presets: Ref<ArenaPreset[]>;
  activeId: Ref<string>;
  ready: Ref<boolean>;
  error: Ref<string>;
  addPreset(name: string, config: ArenaConfig): Promise<ArenaPreset>;
  updatePreset(id: string, name: string, config: ArenaConfig): Promise<void>;
  removePreset(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  resetBuiltin(id: string): Promise<void>;
  /**
   * 遠端版才有：線上對戰場地隨機池（每場 match 從已啟用場地隨機選一場）。
   * local（測試頁、單場地概念）不提供 → 後台 UI 以此判斷要不要渲染「線上啟用」勾選。
   */
  enabledIds?: Ref<string[]>;
  /** 遠端版才有：切換某場地是否加入隨機池。池至少保留一場——最後一場的取消會被忽略（UI disable 之外的第二道防線）。 */
  setEnabled?(id: string, on: boolean): Promise<void>;
  /** 遠端版才有：重新從伺服器載入（載入失敗的重試、寫入失敗後的重新同步） */
  reload?: () => Promise<void>;
}

export interface TuningStoreApi {
  stats: Record<string, BeybladeStats>;
  special: SpecialConfig;
  /** 陀螺個體調整：beyId → 鋪滿全欄的 mods/crit/specialPower（永遠涵蓋整本名冊，UI 直接 v-model） */
  beys: Record<string, BeyTuning>;
  ready: Ref<boolean>;
  error: Ref<string>;
  persistStats(): void;
  persistSpecial(): void;
  persistBeys(): void;
  resetStat(key: string): void;
  resetAllStats(): void;
  resetSpecial(): void;
  /** 單顆個體調整還原名冊預設值 */
  resetBey(beyId: string): void;
  /** 遠端版才有 */
  reload?: () => Promise<void>;
  /** 遠端版才有：立刻送出尚未送出的 debounce 寫入（view 卸載時呼叫，避免掉資料） */
  flush?: () => void;
  /** 遠端版才有：flush + 移除 pagehide listener */
  dispose?: () => void;
}

/* ---------- local（localStorage，包既有模組） ---------- */

export const localArenaApi: ArenaStoreApi = {
  presets: localArena.presets,
  activeId: localArena.activeId,
  ready: ref(true),
  error: ref(""),
  async addPreset(name, config) {
    return localArena.addPreset(name, config);
  },
  async updatePreset(id, name, config) {
    localArena.updatePreset(id, name, config);
  },
  async removePreset(id) {
    localArena.removePreset(id);
  },
  async setActive(id) {
    localArena.setActive(id);
  },
  async resetBuiltin(id) {
    localArena.resetBuiltin(id);
  },
};

export const localTuningApi: TuningStoreApi = {
  stats: localStats,
  special: localSpecial,
  beys: localBeys,
  ready: ref(true),
  error: ref(""),
  persistStats,
  persistSpecial,
  persistBeys,
  resetStat,
  resetAllStats,
  resetSpecial,
  resetBey,
};

/* ---------- remote（D1 全域設定） ---------- */

/** 可 flush 的 debounce（view 卸載 / pagehide 時要能立刻送出，避免掉最後一筆）。 */
function debounced(fn: () => void, ms: number): { call(): void; flush(): void; cancel(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  return {
    call() {
      clearTimeout(t);
      t = setTimeout(() => {
        t = undefined;
        fn();
      }, ms);
    },
    flush() {
      if (t !== undefined) {
        clearTimeout(t);
        t = undefined;
        fn();
      }
    },
    cancel() {
      clearTimeout(t);
      t = undefined;
    },
  };
}

/** 回傳是否成功（失敗只設 error，由呼叫端決定要不要重新同步）。keepalive：pagehide flush 時也送得出去。 */
async function putAdminConfig(key: "arena" | "stats" | "special" | "beys", value: unknown, error: Ref<string>): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/config/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      keepalive: true,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    error.value = "";
    return true;
  } catch (e) {
    error.value = `線上儲存失敗：${e instanceof Error ? e.message : String(e)}`;
    return false;
  }
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.floor(Math.random() * 1e9).toString(36);
  }
}

export function createRemoteArenaApi(): ArenaStoreApi {
  const presets = ref<ArenaPreset[]>([]);
  const activeId = ref("");
  const enabledIds = ref<string[]>([]);
  const ready = ref(false);
  const error = ref("");

  async function load(): Promise<void> {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { arena: ArenaConfigBlob };
      presets.value = data.arena.presets;
      activeId.value = data.arena.activeId;
      // 隨機池：剔除已不存在的場地 id；缺欄/剔到空 → fallback [activeId]（與 worker readGameConfig 同規則）
      const valid = (data.arena.enabledIds ?? []).filter((id) => data.arena.presets.some((p) => p.id === id));
      const fallback = data.arena.activeId || data.arena.presets[0]?.id;
      enabledIds.value = valid.length > 0 ? valid : fallback ? [fallback] : [];
      ready.value = true;
      error.value = "";
    } catch (e) {
      error.value = `線上設定載入失敗：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 寫入排隊：整包 PUT 嚴格依序送出（並行 PUT 到達順序不保證 → 舊快照可能蓋掉新狀態）。
  // 排到的那一刻才 snapshot 最新狀態 → 連續操作自然合併成最終狀態。
  // 寫入失敗 → 從伺服器重新載入，讓 UI 與 D1 回到一致（樂觀更新不留分歧）。
  let queue: Promise<void> = Promise.resolve();
  function push(): Promise<void> {
    queue = queue.then(async () => {
      const body: ArenaConfigBlob = { presets: presets.value, activeId: activeId.value, enabledIds: enabledIds.value };
      const ok = await putAdminConfig("arena", body, error);
      if (!ok) await load();
    });
    return queue;
  }

  void load();

  return {
    presets,
    activeId,
    enabledIds,
    ready,
    error,
    async setEnabled(id, on) {
      if (on) {
        if (enabledIds.value.includes(id) || !presets.value.some((p) => p.id === id)) return; // 已啟用 / 未知 id：不打 API
        enabledIds.value = [...enabledIds.value, id];
      } else {
        if (!enabledIds.value.includes(id)) return;
        if (enabledIds.value.length <= 1) return; // 最後一場不可取消（UI disable 之外的第二道防線）
        enabledIds.value = enabledIds.value.filter((x) => x !== id);
      }
      await push();
    },
    async addPreset(name, config) {
      const preset: ArenaPreset = { id: uid(), name: name.trim() || "未命名場地", config: { ...config } };
      presets.value.push(preset);
      if (!activeId.value) activeId.value = preset.id;
      await push();
      return preset;
    },
    async updatePreset(id, name, config) {
      const p = presets.value.find((x) => x.id === id);
      if (!p) return;
      p.name = name.trim() || p.name;
      p.config = { ...config };
      p.userEdited = true;
      await push();
    },
    async removePreset(id) {
      presets.value = presets.value.filter((x) => x.id !== id);
      if (activeId.value === id) activeId.value = presets.value[0]?.id ?? "";
      // 隨機池同步剔除被刪場地；剔到空 → 回落 [activeId]（池至少一場，也避免 PUT 被 server 驗證擋下）
      enabledIds.value = enabledIds.value.filter((x) => x !== id);
      if (enabledIds.value.length === 0 && activeId.value) enabledIds.value = [activeId.value];
      await push();
    },
    async setActive(id) {
      activeId.value = id;
      await push();
    },
    async resetBuiltin(id) {
      const p = presets.value.find((x) => x.id === id);
      if (!p) return;
      const b = localArena.BUILTINS.find((x) => x.name === p.name);
      if (!b) return;
      p.config = { ...b.config };
      p.userEdited = false;
      await push();
    },
    reload: load,
  };
}

export function createRemoteTuningApi(): TuningStoreApi {
  const stats = reactive<Record<string, BeybladeStats>>({});
  const special = reactive<SpecialConfig>({ ...DEFAULT_SPECIAL });
  const beys = reactive<Record<string, BeyTuning>>({});
  const ready = ref(false);
  const error = ref("");

  const pushStats = debounced(() => void putAdminConfig("stats", stats, error), 600);
  const pushSpecial = debounced(() => void putAdminConfig("special", special, error), 600);
  const pushBeys = debounced(() => void putAdminConfig("beys", beys, error), 600);

  async function load(): Promise<void> {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        stats: Record<string, BeybladeStats>;
        special: SpecialConfig;
        beys?: Record<string, Partial<BeyTuning>>;
      };
      // 鋪 STAT_PRESETS 底再蓋 D1 值：D1 blob 缺欄位（日後加新欄位/新類型）不會讓 UI render 炸掉
      for (const [k, v] of Object.entries(data.stats)) stats[k] = { ...(STAT_PRESETS[k] ?? {}), ...v };
      Object.assign(special, data.special);
      // 個體調整：以「整本名冊」為準鋪名冊預設底，再蓋 D1 覆寫（D1 缺顆/缺欄都不會炸 UI）
      for (const b of BEYBLADES) beys[b.id] = mergeBeyTuning(b, data.beys?.[b.id]);
      ready.value = true;
      error.value = "";
    } catch (e) {
      error.value = `線上設定載入失敗：${e instanceof Error ? e.message : String(e)}`;
    }
  }
  void load();

  function flush(): void {
    pushStats.flush();
    pushSpecial.flush();
    pushBeys.flush();
  }
  // 整頁卸載（F5/關分頁/外連）也要把未送出的寫入射出去（fetch keepalive 撐住）
  const onPageHide = () => flush();
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

  return {
    stats,
    special,
    beys,
    ready,
    error,
    persistStats: () => pushStats.call(),
    persistSpecial: () => pushSpecial.call(),
    persistBeys: () => pushBeys.call(),
    resetStat(key) {
      if (STAT_PRESETS[key]) {
        stats[key] = { ...STAT_PRESETS[key] };
        pushStats.call();
      }
    },
    resetAllStats() {
      for (const k of Object.keys(STAT_PRESETS)) stats[k] = { ...STAT_PRESETS[k] };
      pushStats.call();
    },
    resetSpecial() {
      Object.assign(special, DEFAULT_SPECIAL);
      pushSpecial.call();
    },
    resetBey(beyId) {
      const bey = getBey(beyId);
      if (!bey) return;
      beys[beyId] = defaultBeyTuning(bey);
      pushBeys.call();
    },
    reload: load,
    flush,
    dispose() {
      flush();
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    },
  };
}
