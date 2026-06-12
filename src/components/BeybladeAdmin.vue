<script setup lang="ts">
import { computed } from "vue";
import { PRESET_LABELS } from "../physics/presets";
import { localTuningApi, type TuningStoreApi } from "../store/adminBackend";
import { BEYBLADES, beyFullName } from "../game/beyblades";
import BbIcon from "./ui/BbIcon.vue";

// 資料源注入：不傳 = localStorage（測試頁用那份）；/admin/* 會傳 D1 遠端版
const props = withDefaults(defineProps<{ tuning?: TuningStoreApi; showGoBattle?: boolean }>(), {
  tuning: undefined,
  showGoBattle: true, // 線上(D1)模式會關掉：測試頁吃的是本機數值
});
const tuning = props.tuning ?? localTuningApi;
const { stats, beys, ready, error } = tuning;
const resetStat = tuning.resetStat.bind(tuning);
const resetAllStats = tuning.resetAllStats.bind(tuning);
const resetBey = tuning.resetBey.bind(tuning);

defineEmits<{ (e: "go-battle"): void }>();

// 後台滑桿只調四圍（crit / specialPower 屬個體差，在下方「個體調整」區調）→ key 收窄到四圍
const STAT_FIELDS: { key: "attack" | "defense" | "stamina" | "weight"; label: string; hint: string }[] = [
  { key: "attack", label: "攻擊", hint: "碰撞扣對手血量（耐久）+ 擊退" },
  { key: "defense", label: "防禦", hint: "減少自身受到的血量傷害 + 擊退" },
  { key: "stamina", label: "續航", hint: "越高自旋（續航條）衰減越慢" },
  { key: "weight", label: "重量", hint: "血量上限 + 抗擊退 / 抗出界" },
];

const TYPE_COLORS: Record<string, string> = {
  attack: "#e8442e",
  defense: "#2e9fe8",
  stamina: "#57d96b",
  balance: "#ffb31f",
};
// computed：遠端模式下 stats 是非同步載入，keys 會晚到
const typeKeys = computed(() => Object.keys(stats));

function onInput() {
  tuning.persistStats();
}

/* ---------- 個體調整（10 顆名冊各自的 mods/crit/specialPower） ---------- */

// mods 夾制範圍與 worker applyBeyOverrides 一致（0.8~1.2）；crit 0~0.25、specialPower 0.8~1.4
const MOD_FIELDS: { key: "attack" | "defense" | "stamina" | "weight"; label: string }[] = [
  { key: "attack", label: "攻擊×" },
  { key: "defense", label: "防禦×" },
  { key: "stamina", label: "續航×" },
  { key: "weight", label: "重量×" },
];

// 遠端模式 beys 非同步載入（ready 前不渲染本區）；只渲染名冊內的顆（D1 多出的孤兒 id 不顯示）
const rosterReady = computed(() => BEYBLADES.every((b) => !!beys[b.id]));

function onBeyInput() {
  tuning.persistBeys();
}
</script>

<template>
  <div v-if="error" class="store-error">
    {{ error }}
    <button v-if="tuning.reload" class="retry" @click="tuning.reload()">重試</button>
  </div>
  <div v-if="!ready && !error" class="store-loading">載入線上設定中…</div>
  <div v-else-if="ready" class="stats-admin">
    <div class="head">
      <p class="intro">
        編輯四種陀螺的 攻 / 防 / 續 / 重（改動即時儲存）。
        現行預設已校過平衡：攻擊剋持久、持久剋防禦、防禦剋攻擊。改動會打破此平衡，請搭配
        <code>npm run balance</code> 驗證。
      </p>
      <button class="reset-all" @click="resetAllStats"><BbIcon name="arrow-counterclockwise" :size="14" /> 全部還原預設</button>
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
      <h3><BbIcon name="gear" :size="16" /> 個體調整（名冊 10 顆各自的個體差）</h3>
    </div>
    <p class="intro">
      四欄倍率乘在「該類型基礎屬性」上（1.00＝不增減）；會心、必殺強度為絕對值。
      伺服器套用時會夾制在 倍率 0.8~1.2、會心 0~0.25、必殺強度 0.8~1.4。必殺技數值請到「必殺技後台」調整。
    </p>
    <div v-if="rosterReady" class="bey-grid">
      <div v-for="b in BEYBLADES" :key="b.id" class="bey-card" :style="{ borderColor: TYPE_COLORS[b.type] }">
        <div class="type-head">
          <h4 :style="{ color: TYPE_COLORS[b.type] }">{{ beyFullName(b) }}</h4>
          <button class="reset" @click="resetBey(b.id)">還原</button>
        </div>
        <div class="sp-grid bey-fields">
          <label v-for="f in MOD_FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <b>{{ beys[b.id].mods[f.key].toFixed(2) }}</b></span>
            <input type="range" min="0.8" max="1.2" step="0.01" v-model.number="beys[b.id].mods[f.key]" @input="onBeyInput" />
          </label>
          <label class="field">
            <span>會心機率 <b>{{ (beys[b.id].crit * 100).toFixed(1) }}%</b></span>
            <input type="range" min="0" max="0.25" step="0.005" v-model.number="beys[b.id].crit" @input="onBeyInput" />
          </label>
          <label class="field">
            <span>必殺強度 <b>{{ beys[b.id].specialPower.toFixed(2) }}</b></span>
            <input type="range" min="0.8" max="1.4" step="0.05" v-model.number="beys[b.id].specialPower" @input="onBeyInput" />
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
.bey-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.bey-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left-width: 4px;
  border-radius: 12px;
  padding: 14px 16px;
}
.bey-card h4 {
  margin: 0;
  font-size: 15px;
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
  .grid,
  .bey-grid {
    grid-template-columns: 1fr;
  }
  .head {
    flex-direction: column;
  }
}
</style>
