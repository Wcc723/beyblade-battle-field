<script setup lang="ts">
// 陀螺庫（/roster）：上半＝我的出賽陣容 3 格（縮圖 + 必殺技），點格子開 BeyPicker 抽屜
// 選擇/替換；下半＝全名冊卡片牆（瀏覽用），點卡片也開 BeyPicker 預選該顆。
// lineup 持久化在 user_settings（PUT 全量 settings——先 GET 留存其他欄位再合併送出，
// 否則 worker 端 sanitize 會把缺欄重設、洗掉其他設定）。
import { computed, onMounted, reactive, ref, watch } from "vue";
import { BEYBLADES, getBey, beyFullName } from "../game/beyblades";
import { PRESET_LABELS } from "../physics/presets";
import { SPECIAL_DESCS, SPECIAL_ORDER, getSpecialDesc } from "../game/specialDesc";
import BbIcon from "../components/ui/BbIcon.vue";
import RadarHex from "../components/ui/RadarHex.vue";
// 色票/雷達正規化共用 BeyPicker 的 named exports（抽屜內外同一份，數值不飄移）
import BeyPicker, { TYPE_BADGE, TYPE_COLOR, DIM_LABELS, radarValues } from "../components/BeyPicker.vue";

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

// 必殺技 select 選項：順序/文案統一吃 specialDesc（描述小字同源）
const SPECIAL_OPTIONS = SPECIAL_ORDER.map((k) => ({ value: k, label: SPECIAL_DESCS[k].name }));

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

/* ---- 陣容編輯：一律經 BeyPicker 抽屜選擇/替換；slot-x 直接移除 ---- */
function inLineup(beyId: string): boolean {
  return lineup.some((e) => e.beyId === beyId);
}
function removeAt(i: number) {
  lineup.splice(i, 1);
  notice.value = "";
}

/* ---- BeyPicker 抽屜狀態 ---- */
const pickerOpen = ref(false);
/** 目標陣容格（null＝陣容已滿且從卡片牆點了未出賽顆——只能瀏覽） */
const pickerSlot = ref<number | null>(null);
const pickerInitial = ref<string | undefined>(undefined);
const lineupIds = computed(() => lineup.map((e) => e.beyId));

/** 點陣容格（空格/已佔格皆可）：空格夾到 lineup 尾端（lineup 是 dense 陣列） */
function openSlotPicker(i: number) {
  const idx = Math.min(i, lineup.length);
  pickerSlot.value = idx;
  pickerInitial.value = lineup[idx]?.beyId;
  pickerOpen.value = true;
}
/** 點名冊卡片：已出賽 → 開該格；未出賽 → 第一個空格（已滿則 null＝只能瀏覽） */
function openCardPicker(beyId: string) {
  const idx = lineup.findIndex((e) => e.beyId === beyId);
  pickerSlot.value = idx >= 0 ? idx : lineup.length < 3 ? lineup.length : null;
  pickerInitial.value = beyId;
  pickerOpen.value = true;
}
/** 抽屜確認：替換既有格（保留該格已選必殺技）或新增到尾端 */
function onPick(beyId: string) {
  const i = pickerSlot.value;
  if (i === null) return;
  const entry = lineup[i];
  if (entry) entry.beyId = beyId;
  else lineup.push({ beyId, special: "" });
  pickerOpen.value = false;
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
            <div class="slot-top">
              <span class="order">{{ i + 1 }}</span>
              <template v-if="slot">
                <button class="slot-hit" title="更換此格陀螺" @click="openSlotPicker(i)">
                  <span class="slot-thumb">
                    <img :src="`/beyblades/${slot.bey.type}-64.webp`" alt="" width="40" height="40" />
                  </span>
                  <span class="slot-name">
                    <b>{{ slot.bey.name }}</b>
                    <span class="f-badge" :class="TYPE_BADGE[slot.bey.type]">{{ PRESET_LABELS[slot.bey.type] }}</span>
                  </span>
                  <BbIcon name="arrow-repeat" :size="13" class="swap-ic" />
                </button>
                <button class="slot-x" title="移出陣容" @click="removeAt(i)">
                  <BbIcon name="x" :size="14" />
                </button>
              </template>
              <button v-else class="slot-add" @click="openSlotPicker(i)">
                <BbIcon name="plus" :size="14" />選擇陀螺加入
              </button>
            </div>
            <div v-if="slot" class="slot-sp">
              <label class="slot-special">
                <span class="sp-label">必殺技</span>
                <span class="f-select">
                  <select v-model="slot.entry.special">
                    <option v-for="o in SPECIAL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </span>
              </label>
              <p class="sp-desc">{{ getSpecialDesc(slot.entry.special).desc }}</p>
            </div>
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
          @click="openCardPicker(bey.id)"
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
      <p class="hint">點卡片開啟選擇器加入或替換陣容。六維為全名冊相對值（會心＝爆擊機率、必殺＝必殺技強度）。</p>
    </section>

    <!-- 陀螺選擇器（off-canvas 底部抽屜） -->
    <BeyPicker
      :open="pickerOpen"
      :slot-index="pickerSlot"
      :lineup-ids="lineupIds"
      :initial-bey-id="pickerInitial"
      @close="pickerOpen = false"
      @pick="onPick"
    />
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
  flex-direction: column;
  gap: 7px;
  padding: 10px 11px;
  min-height: 58px;
  background: linear-gradient(180deg, #171a21, #11141a);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.slot.empty {
  box-shadow: inset 0 0 0 1px rgba(170, 180, 196, 0.14);
}
.slot-top {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 40px;
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
/* 點擊熱區：縮圖 + 名字（開 BeyPicker 替換此格） */
.slot-hit {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  background: none;
  -webkit-tap-highlight-color: transparent;
}
.slot-thumb {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 36%, #2c323d, #12151b 76%);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
  box-shadow: inset 0 0 0 1px rgba(170, 180, 196, 0.2);
}
.slot-thumb img {
  display: block;
  width: 34px;
  height: 34px;
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
/* 換裝箭頭：hover 熱區時亮起提示可替換 */
.swap-ic {
  flex: none;
  margin-left: auto;
  color: var(--muted);
  opacity: 0.55;
  transition: opacity 0.15s, color 0.15s;
}
.slot-hit:hover .swap-ic {
  color: var(--accent);
  opacity: 1;
}
/* 空格：整列幽靈鍵開選擇器 */
.slot-add {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0;
  border: 0;
  cursor: pointer;
  color: var(--muted);
  font-size: 12.5px;
  letter-spacing: 0.08em;
  background: none;
  transition: color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.slot-add:hover {
  color: var(--accent);
}
/* 必殺技列 + 描述小字（縮排對齊名字欄） */
.slot-sp {
  margin-left: 37px;
}
.slot-special {
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
.sp-desc {
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.55;
  letter-spacing: 0.03em;
  color: var(--muted);
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
/* 超窄機（<380px）：必殺技列不縮排（爭取描述寬度） */
@media (max-width: 379.98px) {
  .slot-sp {
    margin-left: 0;
  }
}
</style>
