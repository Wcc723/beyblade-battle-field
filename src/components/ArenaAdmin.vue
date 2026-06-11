<script setup lang="ts">
import { reactive, ref } from "vue";
import type { ArenaConfig } from "../physics/types";
import { DEFAULT_ARENA } from "../physics/engine";
import { localArenaApi, type ArenaStoreApi } from "../store/adminBackend";

// 資料源注入：不傳 = localStorage（測試頁用那份）；/admin/* 會傳 D1 遠端版
const props = withDefaults(defineProps<{ store?: ArenaStoreApi; showGoBattle?: boolean }>(), {
  store: undefined,
  showGoBattle: true, // 線上(D1)模式會關掉：測試頁吃的是本機數值，避免「改了線上以為測試頁也變了」
});
const store = props.store ?? localArenaApi;
const { presets, activeId, ready, error } = store;

defineEmits<{ (e: "go-battle"): void }>();

interface FieldDesc {
  key: keyof ArenaConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: FieldDesc[] = [
  { key: "radius", label: "場地半徑", min: 150, max: 400, step: 10 },
  { key: "centerPull", label: "向心力", min: 0, max: 500, step: 10 },
  { key: "friction", label: "摩擦", min: 0, max: 2, step: 0.05 },
  { key: "swirl", label: "繞圈力", min: 0, max: 400, step: 10 },
  { key: "spinDecayBase", label: "自旋衰減", min: 10, max: 200, step: 5 },
  { key: "restitution", label: "反彈係數", min: 0, max: 1, step: 0.05 },
  { key: "hpBase", label: "血量基準", min: 400, max: 3000, step: 50 },
  { key: "collisionSpinLoss", label: "碰撞耗血", min: 0, max: 3, step: 0.05 },
  { key: "knockback", label: "擊退力道", min: 1, max: 4, step: 0.05 },
  { key: "oppSpinBonus", label: "反向碰撞加成", min: 1, max: 3, step: 0.1 },
  { key: "spinKnockback", label: "轉速擊退加成", min: 0, max: 2, step: 0.05 },
  { key: "wallBounce", label: "牆壁反彈", min: 0, max: 1, step: 0.05 },
  { key: "wallSpinLoss", label: "撞牆耗血", min: 0, max: 1, step: 0.02 },
  { key: "ringOutSpeed", label: "出界門檻速度", min: 80, max: 1600, step: 20 },
  { key: "gravity", label: "重力", min: 300, max: 2000, step: 50 },
  { key: "jumpPop", label: "碰撞彈跳", min: 0, max: 1, step: 0.05 },
];

const draft = reactive<ArenaConfig>({ ...DEFAULT_ARENA });
const name = ref("我的場地");
const editingId = ref<string>(""); // 非空 = 正在編輯既有預設

// 方形場(box) / 綠色實體內牆(softWall) 當「可選模組」：各自獨立開關 + 參數，套到任何場地。
const BOX_DEFAULT = { half: 230, cornerGap: 60, wallBounce: 0.6, cornerScore: 2 };
const SW_DEFAULT = {
  radius: 208, bandHalf: 7, topAngle: Math.PI / 2,
  wallHeight: 10, wallBounce: 0.6, spinLoss: 0.12,
  accelBoost: 150, accelInward: 110, accelMinSpin: 0.12,
};
const useBox = ref(false);
const useSoftWall = ref(false);
const boxDraft = reactive({ ...BOX_DEFAULT });
const swDraft = reactive({ ...SW_DEFAULT });

// 使用者「手動勾選」綠色內牆時，自動套用「擊飛越牆」需要的 jump 物理（碰撞彈跳↑、重力↓）。
// 用 @change（只在使用者互動時觸發）而非 watch → 載入既有 preset（程式設 useSoftWall）不會誤改 gravity/jumpPop。
function onSoftWallToggle() {
  if (useSoftWall.value) {
    if (draft.jumpPop < 0.5) draft.jumpPop = 0.7;
    if (draft.gravity > 500) draft.gravity = 350;
  }
}

/** 組出最終 config：純量 draft + 視開關掛上 box / softWall。 */
function buildConfig(): ArenaConfig {
  const cfg: ArenaConfig = { ...draft };
  cfg.box = useBox.value ? { ...boxDraft } : undefined;
  cfg.softWall = useSoftWall.value ? { ...swDraft } : undefined;
  return cfg;
}

function loadToEditor(id: string) {
  const p = presets.value.find((x) => x.id === id);
  if (!p) return;
  Object.assign(draft, p.config);
  draft.box = undefined; // box/softWall 交給獨立模組管
  draft.softWall = undefined;
  useBox.value = !!p.config.box;
  if (p.config.box) Object.assign(boxDraft, p.config.box);
  useSoftWall.value = !!p.config.softWall;
  if (p.config.softWall) Object.assign(swDraft, p.config.softWall);
  name.value = p.name;
  editingId.value = p.id;
}

async function saveAsNew() {
  const p = await store.addPreset(name.value, buildConfig());
  editingId.value = p.id;
}

async function updateCurrent() {
  if (!editingId.value) return;
  await store.updatePreset(editingId.value, name.value, buildConfig());
}

function resetDraft() {
  Object.assign(draft, DEFAULT_ARENA);
  draft.box = undefined;
  draft.softWall = undefined;
  useBox.value = false;
  useSoftWall.value = false;
  Object.assign(boxDraft, BOX_DEFAULT);
  Object.assign(swDraft, SW_DEFAULT);
  name.value = "我的場地";
  editingId.value = "";
}

async function del(id: string) {
  await store.removePreset(id);
  if (editingId.value === id) resetDraft();
}

/** 內建場還原原廠（清掉 userEdited）；若正在編輯它，順手重載編輯器。 */
async function factoryReset(id: string) {
  await store.resetBuiltin(id);
  if (editingId.value === id) loadToEditor(id);
}
</script>

<template>
  <div v-if="error" class="store-error">
    ⚠️ {{ error }}
    <button v-if="store.reload" class="retry" @click="store.reload()">重試</button>
  </div>
  <div v-if="!ready && !error" class="store-loading">載入線上設定中…</div>
  <div v-else-if="ready" class="admin">
    <!-- 編輯器 -->
    <section class="editor card">
      <h3>場地參數編輯器</h3>
      <label class="name-field">
        場地名稱
        <input type="text" v-model="name" placeholder="例如：高速場 / 出界地獄" />
      </label>

      <div class="grid">
        <label v-for="f in FIELDS" :key="f.key" class="field">
          <span>{{ f.label }} <b>{{ Number(draft[f.key]).toFixed(f.step < 1 ? 2 : 0) }}</b></span>
          <input
            type="range"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            v-model.number="draft[f.key] as number"
          />
        </label>
      </div>

      <!-- 可選模組：方形場 / 綠色實體內牆（各自獨立開關，可套到任何場地） -->
      <div class="modules">
        <label class="toggle">
          <input type="checkbox" v-model="useBox" />
          <span>方形場（四角出界 + 四邊反彈）</span>
          <i>不開＝圓形場（沿用上方半徑 + 邊緣分區出界）</i>
        </label>
        <div v-if="useBox" class="sub-grid">
          <label class="field">
            <span>場地邊長 <b>{{ boxDraft.half.toFixed(0) }}</b></span>
            <input type="range" min="150" max="320" step="10" v-model.number="boxDraft.half" />
          </label>
          <label class="field">
            <span>角落開口（越大越易出界）<b>{{ boxDraft.cornerGap.toFixed(0) }}</b></span>
            <input type="range" min="20" max="120" step="5" v-model.number="boxDraft.cornerGap" />
          </label>
        </div>

        <label class="toggle">
          <input type="checkbox" v-model="useSoftWall" @change="onSoftWallToggle" />
          <span>綠色實體內牆（M 形・撞牆反彈・被擊飛才出得去）</span>
          <i>方形場 / 圓形場都能套；被碰撞擊飛到空中才飛得出綠框</i>
        </label>
        <div v-if="useSoftWall" class="sub-grid">
          <label class="field">
            <span>綠牆半徑 <b>{{ swDraft.radius.toFixed(0) }}</b></span>
            <input type="range" min="120" max="300" step="2" v-model.number="swDraft.radius" />
          </label>
          <label class="field">
            <span>綠牆高度（越高越難飛出去）<b>{{ swDraft.wallHeight.toFixed(0) }}</b></span>
            <input type="range" min="4" max="50" step="1" v-model.number="swDraft.wallHeight" />
          </label>
          <label class="field">
            <span>頂部加速強度 <b>{{ swDraft.accelBoost.toFixed(0) }}</b></span>
            <input type="range" min="0" max="300" step="10" v-model.number="swDraft.accelBoost" />
          </label>
          <label class="field">
            <span>向心拉 funnel <b>{{ swDraft.accelInward.toFixed(0) }}</b></span>
            <input type="range" min="0" max="200" step="10" v-model.number="swDraft.accelInward" />
          </label>
          <p class="hint">
            擊飛越牆需要「碰撞彈跳↑ + 重力↓」——開啟時已自動套建議值（碰撞彈跳 0.7、重力 350），可用上方滑桿微調。出界很罕見（~3%）是設計如此。
          </p>
        </div>
      </div>

      <div class="actions">
        <button class="primary" @click="saveAsNew">＋ 另存為新場地</button>
        <button v-if="editingId" @click="updateCurrent">💾 更新此場地</button>
        <button class="ghost" @click="resetDraft">↺ 重設為預設值</button>
      </div>
    </section>

    <!-- 已存場地列表 -->
    <section class="list card">
      <h3>已儲存場地（{{ presets.length }}）</h3>
      <p v-if="presets.length === 0" class="empty">尚無場地，先在左側編輯後「另存為新場地」。</p>
      <ul>
        <li v-for="p in presets" :key="p.id" :class="{ active: p.id === activeId }">
          <div class="info">
            <span class="dot" v-if="p.id === activeId">●</span>
            <span class="pname">{{ p.name }}</span>
            <span class="tag" v-if="p.id === activeId">套用中</span>
            <span class="tag builtin" v-if="p.builtin">內建</span>
          </div>
          <div class="ops">
            <button @click="store.setActive(p.id)" :disabled="p.id === activeId">套用</button>
            <button @click="loadToEditor(p.id)">編輯</button>
            <button v-if="p.builtin && p.userEdited" @click="factoryReset(p.id)" title="還原成程式碼原廠值">↺ 原廠</button>
            <button
              class="danger"
              :disabled="presets.length <= 1"
              :title="presets.length <= 1 ? '至少要保留一個場地' : ''"
              @click="del(p.id)"
            >刪除</button>
          </div>
        </li>
      </ul>
      <button v-if="props.showGoBattle" class="go" @click="$emit('go-battle')">→ 回對戰場試打</button>
      <p v-else class="online-note">測試頁（🧪 / 📱）吃的是「本機測試」那份設定，這裡改的是線上對戰用的全域設定。</p>
    </section>
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
  margin: 0;
}
.store-loading {
  color: var(--muted);
  font-size: 14px;
  padding: 30px 0;
  text-align: center;
}
.admin {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 18px;
  align-items: start;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px 18px;
}
.card h3 {
  margin: 0 0 14px;
  font-size: 16px;
}
.name-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.name-field input {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.field b {
  color: var(--text);
}
.field input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}
.modules {
  margin-top: 18px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13.5px;
  color: var(--text);
  cursor: pointer;
  flex-wrap: wrap;
}
.toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}
.toggle i {
  flex-basis: 100%;
  margin-left: 25px;
  font-style: normal;
  font-size: 11.5px;
  color: var(--muted);
}
.sub-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  margin: 2px 0 6px 25px;
  padding: 10px 14px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 9px;
}
.sub-grid .hint {
  grid-column: 1 / -1;
  margin: 2px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.actions button,
.go {
  border-radius: 9px;
  padding: 9px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
}
.actions .primary {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
.actions .ghost {
  background: transparent;
  color: var(--muted);
}
.list ul {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 12px;
}
.list li.active {
  border-color: var(--accent);
}
.info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dot {
  color: var(--accent);
  font-size: 11px;
}
.pname {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 1px 6px;
}
.tag.builtin {
  color: var(--muted);
  border-color: var(--line);
}
.ops {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.ops button {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 12px;
  cursor: pointer;
}
.ops button:disabled {
  opacity: 0.4;
  cursor: default;
}
.ops .danger {
  color: var(--red);
}
.empty {
  color: var(--muted);
  font-size: 13px;
}
.go {
  background: var(--panel-2);
}
@media (max-width: 880px) {
  .admin {
    grid-template-columns: 1fr;
  }
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
