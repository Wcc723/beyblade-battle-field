<script setup lang="ts">
import type { SpecialConfig } from "../physics/types";
import { localTuningApi, type TuningStoreApi } from "../store/adminBackend";
import BbIcon from "./ui/BbIcon.vue";

// 資料源注入：不傳 = localStorage（測試頁用那份）；/admin/* 會傳 D1 遠端版
const props = withDefaults(defineProps<{ tuning?: TuningStoreApi; showGoBattle?: boolean }>(), {
  tuning: undefined,
  showGoBattle: true, // 線上(D1)模式會關掉：測試頁吃的是本機數值
});
const tuning = props.tuning ?? localTuningApi;
const { special, ready, error } = tuning;
const resetSpecial = tuning.resetSpecial.bind(tuning);

defineEmits<{ (e: "go-battle"): void }>();

// 滑桿欄位（graceTime 為 legacy 統一欄位，UI 不再提供——五招各自的 *GraceTime 在各卡片第一格）
type SpField = { key: Exclude<keyof SpecialConfig, "graceTime">; label: string; min: number; max: number; step: number };
const RUSH_FIELDS: SpField[] = [
  { key: "rushGraceTime", label: "開場緩衝(秒)", min: 0, max: 10, step: 0.5 },
  { key: "rushChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "rushCooldown", label: "冷卻(秒)", min: 0.5, max: 30, step: 0.5 },
  { key: "rushMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "rushRange", label: "觸發距離", min: 40, max: 250, step: 10 },
  { key: "rushDamage", label: "傷害", min: 0, max: 1200, step: 50 },
  { key: "rushSpeed", label: "加速量", min: 0, max: 600, step: 20 },
];
const BLAST_FIELDS: SpField[] = [
  { key: "blastGraceTime", label: "開場緩衝(秒)", min: 0, max: 10, step: 0.5 },
  { key: "blastChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "blastCooldown", label: "冷卻(秒)", min: 0.2, max: 30, step: 0.5 },
  { key: "blastMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "blastImpactMin", label: "撞擊門檻", min: 50, max: 400, step: 10 },
  { key: "blastDamage", label: "傷害", min: 0, max: 1000, step: 50 },
  { key: "blastPush", label: "彈開力道", min: 0, max: 700, step: 20 },
];
const DASH_FIELDS: SpField[] = [
  { key: "dashGraceTime", label: "開場緩衝(秒)", min: 0, max: 10, step: 0.5 },
  { key: "dashChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "dashCooldown", label: "冷卻(秒)", min: 0.5, max: 30, step: 0.5 },
  { key: "dashMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "dashTriggerSpin", label: "觸發自旋比", min: 0.1, max: 0.9, step: 0.05 },
  { key: "dashSpinRestore", label: "回補自旋", min: 0, max: 3000, step: 100 },
  { key: "dashDuration", label: "加速時長(秒)", min: 0.5, max: 5, step: 0.25 },
  { key: "dashAccel", label: "加速強度", min: 0, max: 1500, step: 50 },
  { key: "dashMaxSpeedMul", label: "速度上限×", min: 0.2, max: 1, step: 0.05 },
];
const VORTEX_FIELDS: SpField[] = [
  { key: "vortexGraceTime", label: "開場緩衝(秒)", min: 0, max: 10, step: 0.5 },
  { key: "vortexChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "vortexCooldown", label: "冷卻(秒)", min: 0.5, max: 30, step: 0.5 },
  { key: "vortexMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "vortexRange", label: "觸發距離", min: 80, max: 350, step: 10 },
  { key: "vortexPull", label: "吸引力道", min: 0, max: 800, step: 20 },
  { key: "vortexSpinDrain", label: "抽旋/秒", min: 0, max: 800, step: 10 },
  { key: "vortexDuration", label: "持續(秒)", min: 0.5, max: 5, step: 0.25 },
];
const CLONE_FIELDS: SpField[] = [
  { key: "cloneGraceTime", label: "開場緩衝(秒)", min: 0, max: 10, step: 0.5 },
  { key: "cloneChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "cloneCooldown", label: "冷卻(秒)", min: 0.5, max: 30, step: 0.5 },
  { key: "cloneMaxUses", label: "每回合次數", min: 1, max: 5, step: 1 },
  { key: "cloneRange", label: "召喚距離", min: 80, max: 400, step: 10 },
  { key: "cloneDuration", label: "持續(秒)", min: 1, max: 8, step: 0.5 },
  { key: "cloneAttackMul", label: "傷害倍率", min: 0.1, max: 1, step: 0.05 },
  { key: "cloneSpin", label: "分身自旋", min: 500, max: 3000, step: 100 },
  { key: "cloneHoming", label: "追擊強度", min: 0, max: 600, step: 20 },
];
function onSpecial() {
  tuning.persistSpecial();
}
</script>

<template>
  <div v-if="error" class="store-error">
    {{ error }}
    <button v-if="tuning.reload" class="retry" @click="tuning.reload()">重試</button>
  </div>
  <div v-if="!ready && !error" class="store-loading">載入線上設定中…</div>
  <div v-else-if="ready" class="special-admin">
    <div class="special-head">
      <h3><BbIcon name="lightning" :size="16" /> 必殺技數值（每招分開設定）</h3>
      <button class="reset" @click="resetSpecial">還原預設</button>
    </div>
    <p class="intro">
      每招各自的「開場緩衝」＝開場 N 秒內該招不會觸發（讓開場對撞先定調）。改動即時儲存；
      平衡工具不裝必殺技——裝技明顯強於不裝是刻意設計。
    </p>
    <div class="special-grid">
      <div class="special-card">
        <h4>衝刺突進</h4>
        <p class="sp-hint">
          <b>觸發</b>：逼近對手（進入觸發距離 {{ special.rushRange }}）時，以 {{ Math.round(special.rushChance * 100) }}% 機率發動，朝對手爆發加速衝撞 + 直接扣血。<br />
          <b>限制</b>：開場 {{ special.rushGraceTime }}s 內不觸發、發動後冷卻 <b>{{ special.rushCooldown }}s</b>、每回合最多 <b>{{ special.rushMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in RUSH_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>
      <div class="special-card">
        <h4>衝擊</h4>
        <p class="sp-hint">
          <b>觸發</b>：自己打出的撞擊強度 &gt; {{ special.blastImpactMin }} 時，以 {{ Math.round(special.blastChance * 100) }}% 機率發動，把對手彈開 + 扣血（可順勢擊出界）。<br />
          <b>限制</b>：開場 {{ special.blastGraceTime }}s 內不觸發、發動後冷卻 <b>{{ special.blastCooldown }}s</b>、每回合最多 <b>{{ special.blastMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in BLAST_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>

      <div class="special-card">
        <h4>高速移動</h4>
        <p class="sp-hint">
          <b>觸發</b>：自旋（續航）低於 {{ Math.round(special.dashTriggerSpin * 100) }}% 時，以 {{ Math.round(special.dashChance * 100) }}% 機率發動，回補 {{ special.dashSpinRestore }} 自旋（續命）+ {{ special.dashDuration }}s 移動加速（夾速度上限，不會自爆出界）。<br />
          <b>限制</b>：開場 {{ special.dashGraceTime }}s 內不觸發、冷卻 <b>{{ special.dashCooldown }}s</b>、每回合最多 <b>{{ special.dashMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in DASH_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>

      <div class="special-card">
        <h4>旋渦</h4>
        <p class="sp-hint">
          <b>觸發</b>：對手進入 {{ special.vortexRange }} 距離時，以 {{ Math.round(special.vortexChance * 100) }}% 機率發動，{{ special.vortexDuration }}s 內把對手往自己拉 + 每秒抽乾對手 {{ special.vortexSpinDrain }} 自旋（拉進來磨，重型/防禦最爽）。<br />
          <b>限制</b>：開場 {{ special.vortexGraceTime }}s 內不觸發、冷卻 <b>{{ special.vortexCooldown }}s</b>、每回合最多 <b>{{ special.vortexMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in VORTEX_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>

      <div class="special-card">
        <h4>分身</h4>
        <p class="sp-hint">
          <b>觸發</b>：對手進入 {{ special.cloneRange }} 距離時，以 {{ Math.round(special.cloneChance * 100) }}% 機率召喚一個分身（傷害 ×{{ special.cloneAttackMul }}、{{ special.cloneDuration }}s 後消失、不計勝負）。<br />
          <b>限制</b>：開場 {{ special.cloneGraceTime }}s 內不觸發、冷卻 <b>{{ special.cloneCooldown }}s</b>、每回合最多 <b>{{ special.cloneMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in CLONE_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>
    </div>

    <button v-if="props.showGoBattle" class="go" @click="$emit('go-battle')">回對戰場試打 <BbIcon name="arrow-right" :size="14" /></button>
    <p v-else class="online-note">測試頁吃的是「本機測試」那份數值，這裡改的是線上對戰用的全域數值。</p>
  </div>
</template>

<style scoped>
.store-error {
  background: rgba(255, 93, 93, 0.08);
  border: 1px solid rgba(255, 93, 93, 0.35);
  color: var(--red);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.store-error .retry {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.online-note {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.5;
  margin: 14px 0 0;
}
.store-loading {
  color: var(--muted);
  font-size: 14px;
  padding: 30px 0;
  text-align: center;
}
.special-admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.special-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.special-head h3 {
  margin: 0;
  font-size: 16px;
}
.intro {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.7;
  max-width: 760px;
}
.special-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.special-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
}
.special-card h4 {
  margin: 0 0 8px;
  font-size: 15px;
}
.sp-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.sp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 18px;
}
@media (max-width: 720px) {
  .sp-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.reset {
  background: var(--panel-2);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 10px;
}
.field b {
  color: var(--text);
}
.field input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}
.go {
  align-self: flex-start;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
</style>
