<script setup lang="ts">
import type { BeybladeStats, SpecialConfig } from "../physics/types";
import { PRESET_LABELS } from "../physics/presets";
import { stats, persistStats, resetStat, resetAllStats } from "../store/statStore";
import { special, persistSpecial, resetSpecial } from "../store/specialStore";

defineEmits<{ (e: "go-battle"): void }>();

type SpField = { key: keyof SpecialConfig; label: string; min: number; max: number; step: number };
const RUSH_FIELDS: SpField[] = [
  { key: "rushChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "rushCooldown", label: "冷卻(秒)", min: 0.5, max: 30, step: 0.5 },
  { key: "rushMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "rushRange", label: "觸發距離", min: 40, max: 250, step: 10 },
  { key: "rushDamage", label: "傷害", min: 0, max: 1200, step: 50 },
  { key: "rushSpeed", label: "加速量", min: 0, max: 600, step: 20 },
];
const BLAST_FIELDS: SpField[] = [
  { key: "blastChance", label: "觸發機率", min: 0, max: 1, step: 0.05 },
  { key: "blastCooldown", label: "冷卻(秒)", min: 0.2, max: 30, step: 0.5 },
  { key: "blastMaxUses", label: "每回合次數", min: 1, max: 9, step: 1 },
  { key: "blastImpactMin", label: "撞擊門檻", min: 50, max: 400, step: 10 },
  { key: "blastDamage", label: "傷害", min: 0, max: 1000, step: 50 },
  { key: "blastPush", label: "彈開力道", min: 0, max: 700, step: 20 },
];
function onSpecial() {
  persistSpecial();
}

const STAT_FIELDS: { key: keyof BeybladeStats; label: string; hint: string }[] = [
  { key: "attack", label: "攻擊", hint: "碰撞扣對手血量（耐久）+ 擊退" },
  { key: "defense", label: "防禦", hint: "減少自身受到的血量傷害 + 擊退" },
  { key: "stamina", label: "續航", hint: "越高自旋（續航條）衰減越慢" },
  { key: "weight", label: "重量", hint: "血量上限 + 抗擊退 / 抗出界" },
];

const TYPE_COLORS: Record<string, string> = {
  attack: "#ff5d5d",
  defense: "#5db4ff",
  stamina: "#6ad08a",
  balance: "#ffd166",
};
const typeKeys = Object.keys(stats);

function onInput() {
  persistStats();
}
</script>

<template>
  <div class="stats-admin">
    <div class="head">
      <p class="intro">
        編輯四種陀螺的 攻 / 防 / 續 / 重（即時存入 localStorage，下一場對戰生效）。
        現行預設已校過平衡：攻擊剋持久、持久剋防禦、防禦剋攻擊。改動會打破此平衡，請搭配
        <code>npm run balance</code> 驗證。
      </p>
      <button class="reset-all" @click="resetAllStats">↺ 全部還原預設</button>
    </div>

    <div class="grid">
      <div v-for="k in typeKeys" :key="k" class="type-card" :style="{ borderColor: TYPE_COLORS[k] }">
        <div class="type-head">
          <h3 :style="{ color: TYPE_COLORS[k] }">{{ PRESET_LABELS[k] || k }}</h3>
          <button class="reset" @click="resetStat(k)">還原</button>
        </div>
        <label v-for="f in STAT_FIELDS" :key="f.key" class="field" :title="f.hint">
          <span>{{ f.label }} <b>{{ stats[k][f.key].toFixed(2) }}</b></span>
          <input
            type="range"
            min="0.2"
            max="2"
            step="0.05"
            v-model.number="stats[k][f.key]"
            @input="onInput"
          />
        </label>
      </div>
    </div>

    <div class="special-head">
      <h3>⚡ 必殺技數值（每招分開設定）</h3>
      <button class="reset" @click="resetSpecial">還原預設</button>
    </div>
    <div class="special-grid">
      <div class="special-card">
        <h4>🗡️ 衝刺突進</h4>
        <p class="sp-hint">
          <b>觸發</b>：逼近對手（進入觸發距離 {{ special.rushRange }}）時，以 {{ Math.round(special.rushChance * 100) }}% 機率發動 → 朝對手爆發加速衝撞 + 直接扣血。<br />
          <b>限制</b>：發動後冷卻 <b>{{ special.rushCooldown }}s</b>、每回合最多 <b>{{ special.rushMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in RUSH_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>
      <div class="special-card">
        <h4>💥 衝擊</h4>
        <p class="sp-hint">
          <b>觸發</b>：自己打出的撞擊強度 &gt; {{ special.blastImpactMin }} 時，以 {{ Math.round(special.blastChance * 100) }}% 機率發動 → 把對手彈開 + 扣血（可順勢擊出界）。<br />
          <b>限制</b>：發動後冷卻 <b>{{ special.blastCooldown }}s</b>、每回合最多 <b>{{ special.blastMaxUses }}</b> 次。
        </p>
        <div class="sp-grid">
          <label v-for="f in BLAST_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ special[f.key] % 1 === 0 ? special[f.key] : special[f.key].toFixed(2) }}</b></span>
            <input type="range" :min="f.min" :max="f.max" :step="f.step" v-model.number="special[f.key]" @input="onSpecial" />
          </label>
        </div>
      </div>
    </div>

    <button class="go" @click="$emit('go-battle')">→ 回對戰場試打</button>
  </div>
</template>

<style scoped>
.stats-admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.intro {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.7;
  max-width: 760px;
}
.intro code {
  background: var(--panel-2);
  padding: 1px 6px;
  border-radius: 5px;
  color: var(--accent);
}
.reset-all {
  flex-shrink: 0;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.type-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left-width: 4px;
  border-radius: 12px;
  padding: 14px 16px;
}
.special-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
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
.type-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.type-head h3 {
  margin: 0;
  font-size: 16px;
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
@media (max-width: 880px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .head {
    flex-direction: column;
  }
}
</style>
