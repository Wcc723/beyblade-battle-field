<script setup lang="ts">
// 陀螺庫（/roster）：上半＝我的出賽陣容 3 格、下半＝全名冊卡片清單（六維雷達）。
// lineup 持久化在 user_settings（PUT 全量 settings——先 GET 留存其他欄位再合併送出，
// 否則 worker 端 sanitize 會把缺欄重設、洗掉其他設定）。
import { computed, onMounted, reactive, ref, watch } from "vue";
import { BEYBLADES, beyFullName, getBey, type BeyDef } from "../game/beyblades";
import { STAT_PRESETS, PRESET_LABELS } from "../physics/presets";
import BbIcon from "../components/ui/BbIcon.vue";
import RadarHex from "../components/ui/RadarHex.vue";

interface LineupEntry {
  beyId: string;
  special: string;
}

/** /api/settings 全量形狀（lineup 以外的欄位原樣留存、合併回送） */
interface UserSettings {
  nickname: string;
  defaultType: string;
  defaultSpin: string;
  defaultSpecial: string;
  launchMode: string;
  sfx: boolean;
  replaySpeed: number;
  lineup: LineupEntry[];
}

const SPECIAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "（無）" },
  { value: "rush", label: "衝刺突進" },
  { value: "blast", label: "衝擊" },
  { value: "dash", label: "高速移動" },
  { value: "vortex", label: "旋渦" },
  { value: "clone", label: "分身" },
];

const TYPE_BADGE: Record<BeyDef["type"], string> = {
  attack: "f-badge--red",
  defense: "f-badge--blue",
  stamina: "f-badge--ok",
  balance: "f-badge--amber",
};
// 雷達多邊形隊色（forge tokens 同色票）
const TYPE_COLOR: Record<BeyDef["type"], string> = {
  attack: "#e8442e",
  defense: "#2e9fe8",
  stamina: "#57d96b",
  balance: "#ffb31f",
};

/* ---- 六維雷達正規化 ----
 * 前四維 raw = STAT_PRESETS[type] × mods（個體差後實際值）、後二維 raw = crit / specialPower；
 * 每維各自對全名冊取 min~max 線性正規化 t = (raw - min) / (max - min)，
 * 再壓到 0.1 + 0.9t（地板 0.1：名冊最弱的維度仍可見、不縮成中心點）。
 */
const DIMS = ["attack", "defense", "stamina", "weight", "crit", "specialPower"] as const;
const DIM_LABELS = ["攻擊", "防禦", "續航", "重量", "會心", "必殺"];

function rawDim(bey: BeyDef, dim: (typeof DIMS)[number]): number {
  if (dim === "crit") return bey.crit;
  if (dim === "specialPower") return bey.specialPower;
  return STAT_PRESETS[bey.type][dim] * (bey.mods[dim] ?? 1);
}
// 名冊固定 → 各維 min/max 建構時算一次
const RANGES = DIMS.map((dim) => {
  const vals = BEYBLADES.map((b) => rawDim(b, dim));
  return { min: Math.min(...vals), max: Math.max(...vals) };
});
function radarValues(bey: BeyDef): number[] {
  return DIMS.map((dim, i) => {
    const { min, max } = RANGES[i];
    const t = max > min ? (rawDim(bey, dim) - min) / (max - min) : 0.5;
    return 0.1 + 0.9 * t;
  });
}

/* ---- 載入 / 儲存 ---- */
const base = ref<UserSettings | null>(null); // GET 留存的全量設定（lineup 以外欄位原樣回送）
const lineup = reactive<LineupEntry[]>([]);
const loading = ref(true);
const saving = ref(false);
const savedAt = ref(0);
const error = ref("");
const notice = ref(""); // 陣容已滿等暫時提示

// 再動陣容就收掉「已儲存」，避免看起來像新改動也存了
watch(lineup, () => {
  savedAt.value = 0;
});

onMounted(async () => {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { settings: UserSettings };
    base.value = data.settings;
    lineup.splice(0, lineup.length, ...data.settings.lineup.map((e) => ({ ...e })));
  } catch (e) {
    error.value = `載入失敗：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    loading.value = false;
  }
});

/* ---- 陣容編輯：點名冊卡片加入 / 已在陣容則移除 ---- */
function inLineup(beyId: string): boolean {
  return lineup.some((e) => e.beyId === beyId);
}
function toggleBey(beyId: string) {
  const idx = lineup.findIndex((e) => e.beyId === beyId);
  if (idx >= 0) {
    lineup.splice(idx, 1);
    notice.value = "";
    return;
  }
  if (lineup.length >= 3) {
    notice.value = "陣容已滿（3 格），請先移除一顆再加入";
    return;
  }
  lineup.push({ beyId, special: "" });
  notice.value = "";
}

/** 固定 3 格 slot 視圖（entry 是 reactive 元素 → 必殺技 v-model 直接生效） */
const slotRows = computed(() =>
  Array.from({ length: 3 }, (_, i) => {
    const entry = lineup[i];
    if (!entry) return null;
    const bey = getBey(entry.beyId);
    return bey ? { entry, bey } : null;
  }),
);

async function save() {
  if (!base.value) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base.value, lineup: lineup.map((e) => ({ ...e })) }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    savedAt.value = Date.now();
  } catch (e) {
    error.value = `儲存失敗：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="roster">
    <!-- 上半：我的出賽陣容 -->
    <section class="plate plate--rivets card">
      <h2 class="page-title"><BbIcon name="lightning" :size="18" />我的出賽陣容</h2>
      <div v-if="loading" class="loading">載入中…</div>
      <template v-else>
        <ol class="slots">
          <li v-for="(slot, i) in slotRows" :key="i" class="slot" :class="{ empty: !slot }">
            <span class="order">{{ i + 1 }}</span>
            <template v-if="slot">
              <div class="slot-main">
                <div class="slot-name">
                  <b>{{ slot.bey.name }}</b>
                  <span class="f-badge" :class="TYPE_BADGE[slot.bey.type]">{{ PRESET_LABELS[slot.bey.type] }}</span>
                </div>
                <label class="slot-special">
                  <span class="sp-label">必殺技</span>
                  <span class="f-select">
                    <select v-model="slot.entry.special">
                      <option v-for="o in SPECIAL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </span>
                </label>
              </div>
              <button class="slot-x" title="移出陣容" @click="toggleBey(slot.entry.beyId)">
                <BbIcon name="x" :size="14" />
              </button>
            </template>
            <span v-else class="slot-empty-txt">點選下方陀螺加入</span>
          </li>
        </ol>
        <p class="hint">
          依 1、2、3 順序出賽。旋向由房間決定：先手（紅）固定右旋、後手（藍）固定左旋——保證每場反向對撞。
        </p>
        <p v-if="notice" class="notice">{{ notice }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button class="f-btn f-btn--primary" :disabled="saving || lineup.length === 0" @click="save">
            <BbIcon name="floppy" :size="15" />{{ saving ? "儲存中…" : "儲存陣容" }}
          </button>
          <span v-if="savedAt && !error" class="saved"><BbIcon name="check" :size="14" />已儲存</span>
        </div>
      </template>
    </section>

    <!-- 下半：陀螺庫全名冊 -->
    <section class="plate card lib">
      <h2 class="page-title"><BbIcon name="gear" :size="18" />陀螺庫</h2>
      <div class="bey-grid">
        <button
          v-for="bey in BEYBLADES"
          :key="bey.id"
          class="bey-card"
          :class="{ picked: inLineup(bey.id) }"
          @click="toggleBey(bey.id)"
        >
          <RadarHex :values="radarValues(bey)" :labels="DIM_LABELS" :color="TYPE_COLOR[bey.type]" />
          <div class="bey-name">{{ beyFullName(bey) }}</div>
          <div class="bey-tags">
            <span class="f-badge" :class="TYPE_BADGE[bey.type]">{{ PRESET_LABELS[bey.type] }}</span>
            <span v-if="inLineup(bey.id)" class="f-badge f-badge--amber">
              <BbIcon name="check" :size="10" />出賽中
            </span>
          </div>
        </button>
      </div>
      <p class="hint">點卡片加入出賽陣容；再點一次移除。六維為全名冊相對值（會心＝爆擊機率、必殺＝必殺技強度）。</p>
    </section>
  </div>
</template>

<style scoped>
.roster {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card {
  padding: 16px 14px 18px;
}
/* ---- 頁標（沿用 SettingsView 語彙） ---- */
.page-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 2px 2px 12px;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 0.16em;
  color: var(--text);
}
.page-title .bb-icon {
  color: var(--accent);
  filter: drop-shadow(0 0 6px rgba(255, 179, 31, 0.45));
}
.loading {
  color: var(--muted);
  padding: 20px 0;
  font-size: 13px;
  letter-spacing: 0.08em;
}
/* ---- 出賽陣容 3 格 ---- */
.slots {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.slot {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 11px;
  min-height: 58px;
  background: linear-gradient(180deg, #171a21, #11141a);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.slot.empty {
  box-shadow: inset 0 0 0 1px rgba(170, 180, 196, 0.14);
}
/* 出賽順序徽章 */
.order {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 14px;
  color: var(--accent);
  background: radial-gradient(circle at 50% 32%, #353c49, #14171d 72%);
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.slot.empty .order {
  color: var(--muted);
}
.slot-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.slot-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.slot-name b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.07em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-special {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
}
.sp-label {
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.slot-special select {
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 12.5px;
}
/* 移出鈕（小型幽靈鍵） */
.slot-x {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  cursor: pointer;
  color: var(--muted);
  background: linear-gradient(180deg, #232831, #14171d);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
  transition: color 0.15s;
}
.slot-x:hover {
  color: var(--red);
}
.slot-empty-txt {
  color: var(--muted);
  font-size: 12.5px;
  letter-spacing: 0.08em;
}
/* ---- 名冊卡片 ---- */
.bey-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.bey-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 10px 8px 12px;
  border: 0;
  cursor: pointer;
  color: var(--text);
  text-align: center;
  background: linear-gradient(180deg, #171a21, #10131a);
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.bey-card:hover {
  background: linear-gradient(180deg, #1c202a, #131720);
}
/* 已在陣容：琥珀內框 + 微光 */
.bey-card.picked {
  box-shadow: inset 0 0 0 1.5px rgba(255, 179, 31, 0.55), inset 0 0 18px rgba(255, 122, 24, 0.12);
}
.bey-card .radar {
  width: 100%;
  height: auto;
}
.bey-name {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 13.5px;
  letter-spacing: 0.06em;
  line-height: 1.25;
}
.bey-tags {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}
/* ---- 提示 / 訊息（沿用 SettingsView 語彙） ---- */
.hint {
  margin: 10px 0 0;
  padding: 8px 11px;
  font-size: 12px;
  line-height: 1.6;
  letter-spacing: 0.03em;
  color: var(--muted);
  background: linear-gradient(180deg, #10131a, #0c0f15);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 0 0 1px rgba(170, 180, 196, 0.12);
}
.notice {
  color: var(--accent);
  font-size: 12.5px;
  margin: 10px 0 0;
  letter-spacing: 0.04em;
}
.error {
  color: var(--red);
  font-size: 13px;
  margin: 10px 0 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.saved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ok);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
/* 超窄機（<380px）：slot 內必殺技換行排 */
@media (max-width: 379.98px) {
  .slot-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}
</style>
