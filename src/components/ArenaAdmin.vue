<script setup lang="ts">
import { reactive, ref } from "vue";
import type { ArenaConfig } from "../physics/types";
import { DEFAULT_ARENA } from "../physics/engine";
import {
  presets,
  activeId,
  addPreset,
  updatePreset,
  removePreset,
  setActive,
} from "../store/arenaStore";

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

function loadToEditor(id: string) {
  const p = presets.value.find((x) => x.id === id);
  if (!p) return;
  Object.assign(draft, p.config);
  name.value = p.name;
  editingId.value = p.id;
}

function saveAsNew() {
  const p = addPreset(name.value, { ...draft });
  editingId.value = p.id;
}

function updateCurrent() {
  if (!editingId.value) return;
  updatePreset(editingId.value, name.value, { ...draft });
}

function resetDraft() {
  Object.assign(draft, DEFAULT_ARENA);
  name.value = "我的場地";
  editingId.value = "";
}

function del(id: string) {
  removePreset(id);
  if (editingId.value === id) resetDraft();
}
</script>

<template>
  <div class="admin">
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
          </div>
          <div class="ops">
            <button @click="setActive(p.id)" :disabled="p.id === activeId">套用</button>
            <button @click="loadToEditor(p.id)">編輯</button>
            <button class="danger" @click="del(p.id)">刪除</button>
          </div>
        </li>
      </ul>
      <button class="go" @click="$emit('go-battle')">→ 回對戰場試打</button>
    </section>
  </div>
</template>

<style scoped>
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
