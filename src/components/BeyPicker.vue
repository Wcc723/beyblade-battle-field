<script lang="ts">
// 共用區（named exports）：類型色票與六維雷達正規化。
// RosterView 的名冊卡片牆同 import 這份，避免兩處色票/正規化各自飄移。
import { BEYBLADES, type BeyDef } from "../game/beyblades";
import { STAT_PRESETS } from "../physics/presets";

/** 類型 → f-badge 變體 class */
export const TYPE_BADGE: Record<BeyDef["type"], string> = {
  attack: "f-badge--red",
  defense: "f-badge--blue",
  stamina: "f-badge--ok",
  balance: "f-badge--amber",
};
/** 類型 → 雷達多邊形隊色（forge tokens 同色票） */
export const TYPE_COLOR: Record<BeyDef["type"], string> = {
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
export const DIM_LABELS = ["攻擊", "防禦", "續航", "重量", "會心", "必殺"];

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
export function radarValues(bey: BeyDef): number[] {
  return DIMS.map((dim, i) => {
    const { min, max } = RANGES[i];
    const t = max > min ? (rawDim(bey, dim) - min) / (max - min) : 0.5;
    return 0.1 + 0.9 * t;
  });
}
</script>

<script setup lang="ts">
// 陀螺選擇器（off-canvas 底部抽屜，比照 BattleRoomView loadout sheet 的 Transition 模式）：
// 上半＝當前瀏覽陀螺大圖 + 全名 + 類型 + 六維雷達；下半＝名冊縮圖網格（點選切換瀏覽、
// 已出賽標記「出賽中」）；底部「加入此格 / 替換此格」確認後 emit pick 交給父層改 lineup。
import { computed, ref, watch } from "vue";
import { beyFullName, getBey } from "../game/beyblades";
import { PRESET_LABELS } from "../physics/presets";
import BbIcon from "./ui/BbIcon.vue";
import RadarHex from "./ui/RadarHex.vue";

const props = defineProps<{
  /** 抽屜開合（v-if + Transition） */
  open: boolean;
  /** 目標陣容格 index（0~2；null＝陣容已滿且該顆不在陣容——只能瀏覽、不能加入） */
  slotIndex: number | null;
  /** 目前陣容 beyId 清單（dense；「出賽中」標記與重複加入判定） */
  lineupIds: string[];
  /** 開啟時預選瀏覽的陀螺（缺省＝第一顆未出賽的） */
  initialBeyId?: string;
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "pick", beyId: string): void }>();

/* ---- 瀏覽狀態：每次開啟重設到 initialBeyId（或第一顆未出賽的） ---- */
const browseId = ref(BEYBLADES[0].id);
watch(
  () => props.open,
  (v) => {
    if (!v) return;
    if (props.initialBeyId && getBey(props.initialBeyId)) {
      browseId.value = props.initialBeyId;
    } else {
      browseId.value = (BEYBLADES.find((b) => !props.lineupIds.includes(b.id)) ?? BEYBLADES[0]).id;
    }
  },
);

const browseBey = computed(() => getBey(browseId.value) ?? BEYBLADES[0]);
/** 目標格目前的佔格陀螺（空格/已滿瀏覽 → null） */
const currentBeyId = computed(() =>
  props.slotIndex === null ? null : (props.lineupIds[props.slotIndex] ?? null),
);

/** 確認鈕狀態：同格/他格重複與陣容已滿都鎖住，文案直接講原因 */
const confirmState = computed<{ label: string; disabled: boolean }>(() => {
  if (props.slotIndex === null) return { label: "陣容已滿—請從上方陣容格替換", disabled: true };
  const id = browseBey.value.id;
  if (id === currentBeyId.value) return { label: "已在此格出賽", disabled: true };
  if (props.lineupIds.includes(id)) return { label: "已在其他格出賽", disabled: true };
  return { label: currentBeyId.value ? "替換此格" : "加入此格", disabled: false };
});

function confirm() {
  if (confirmState.value.disabled) return;
  emit("pick", browseBey.value.id);
}
</script>

<template>
  <Transition name="picker">
    <div v-if="open" class="picker-wrap" @click.self="emit('close')">
      <div class="picker-sheet">
        <!-- 抽屜頭：標題 + 目標格 + 收合 -->
        <div class="pk-head">
          <BbIcon name="crosshair" :size="16" class="pk-head-ic" />
          <b>選擇陀螺</b>
          <span v-if="slotIndex !== null" class="pk-slot-tag">格 {{ slotIndex + 1 }}</span>
          <span class="pk-spacer"></span>
          <button type="button" class="pk-close" aria-label="收合" @click="emit('close')">
            <BbIcon name="x" :size="15" />
          </button>
        </div>

        <div class="pk-body">
          <!-- 上半：當前瀏覽陀螺 -->
          <div class="pk-preview">
            <span class="pk-img-frame">
              <img :src="`/beyblades/${browseBey.type}-128.webp`" alt="" width="132" height="132" />
            </span>
            <div class="pk-meta">
              <div class="pk-name">{{ beyFullName(browseBey) }}</div>
              <span class="f-badge" :class="TYPE_BADGE[browseBey.type]">{{ PRESET_LABELS[browseBey.type] }}</span>
              <RadarHex
                :values="radarValues(browseBey)"
                :labels="DIM_LABELS"
                :color="TYPE_COLOR[browseBey.type]"
                :size="150"
              />
            </div>
          </div>

          <!-- 下半：名冊縮圖網格（點選切換瀏覽） -->
          <div class="pk-grid">
            <button
              v-for="bey in BEYBLADES"
              :key="bey.id"
              type="button"
              class="pk-thumb"
              :class="{ browsing: bey.id === browseBey.id, picked: lineupIds.includes(bey.id) }"
              @click="browseId = bey.id"
            >
              <img :src="`/beyblades/${bey.type}-64.webp`" alt="" width="56" height="56" />
              <span class="pk-thumb-name">{{ bey.name }}</span>
              <span v-if="lineupIds.includes(bey.id)" class="pk-on-duty">出賽中</span>
            </button>
          </div>

          <!-- 確認 -->
          <button
            type="button"
            class="f-btn f-btn--primary pk-confirm"
            :disabled="confirmState.disabled"
            @click="confirm"
          >
            <BbIcon name="check" :size="15" />{{ confirmState.label }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ---- off-canvas：fixed 底部抽屜 + 半透明 backdrop（同 BattleRoomView loadout sheet 語彙） ---- */
.picker-wrap {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  background: rgba(5, 6, 10, 0.55);
}
.picker-sheet {
  width: min(480px, 100%);
  max-height: 84vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #23272f, #15181e 55%, #101319);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 -14px 34px rgba(0, 0, 0, 0.6);
}
.pk-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  background: linear-gradient(180deg, #262b34, #1a1e25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.pk-head b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.18em;
}
.pk-head-ic {
  color: var(--accent);
  filter: drop-shadow(0 0 6px rgba(255, 179, 31, 0.45));
}
.pk-slot-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
  padding: 2px 7px;
  background: rgba(255, 179, 31, 0.12);
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
}
.pk-spacer {
  flex: 1;
}
.pk-close {
  width: 34px;
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
.pk-close:hover {
  color: var(--text);
}
.pk-body {
  padding: 13px 12px 14px;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* ---- 上半預覽：大圖金屬框 + 全名/類型/雷達 ---- */
.pk-preview {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pk-img-frame {
  flex: none;
  width: 132px;
  height: 132px;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 36%, #2c323d, #12151b 76%);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow: inset 0 0 0 1.5px rgba(170, 180, 196, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.pk-img-frame img {
  display: block;
  width: 112px;
  height: 112px;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55));
}
.pk-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.pk-name {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.06em;
  line-height: 1.3;
}
.pk-meta .radar {
  margin: -4px 0 0 -8px;
  max-width: 100%;
  height: auto;
}
/* ---- 下半：名冊縮圖網格 ---- */
.pk-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 7px;
}
.pk-thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 7px 2px 6px;
  border: 0;
  cursor: pointer;
  color: var(--text);
  background: linear-gradient(180deg, #171a21, #10131a);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.pk-thumb:hover {
  background: linear-gradient(180deg, #1c202a, #131720);
}
/* 正在瀏覽：琥珀內框 */
.pk-thumb.browsing {
  box-shadow: inset 0 0 0 1.5px rgba(255, 179, 31, 0.6), inset 0 0 14px rgba(255, 122, 24, 0.14);
}
.pk-thumb img {
  display: block;
  width: 44px;
  height: 44px;
}
.pk-thumb.picked img {
  opacity: 0.55;
}
.pk-thumb-name {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* 出賽中小標（覆在縮圖上緣） */
.pk-on-duty {
  position: absolute;
  top: 3px;
  right: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #14171d;
  background: var(--accent);
  padding: 1px 4px;
  clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px);
}
.pk-confirm {
  width: 100%;
  justify-content: center;
}
/* ---- 抽屜進出場：面板 0.25s 由下滑上、backdrop 同步淡入淡出 ---- */
.picker-enter-active,
.picker-leave-active {
  transition: opacity 0.25s ease;
}
.picker-enter-active .picker-sheet,
.picker-leave-active .picker-sheet {
  transition: transform 0.25s cubic-bezier(0.25, 0.9, 0.3, 1);
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
}
.picker-enter-from .picker-sheet,
.picker-leave-to .picker-sheet {
  transform: translateY(100%);
}
/* 超窄機（<380px）：預覽改直排置中、縮圖 4 欄 */
@media (max-width: 379.98px) {
  .pk-preview {
    flex-direction: column;
  }
  .pk-meta {
    align-items: center;
  }
  .pk-meta .radar {
    margin: 0;
  }
  .pk-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
