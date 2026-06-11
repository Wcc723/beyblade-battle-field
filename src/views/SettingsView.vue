<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useAuth } from "../store/authStore";
import { PRESET_LABELS } from "../physics/presets";

const auth = useAuth();

interface UserSettings {
  nickname: string;
  defaultType: string;
  defaultSpin: string;
  defaultSpecial: string;
  launchMode: string;
  sfx: boolean;
  replaySpeed: number;
}

const SPECIAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "（無）" },
  { value: "rush", label: "🗡️ 衝刺突進" },
  { value: "blast", label: "💥 衝擊" },
  { value: "dash", label: "💨 高速移動" },
  { value: "vortex", label: "🌀 旋渦" },
  { value: "clone", label: "👥 分身" },
];

const form = reactive<UserSettings>({
  nickname: "",
  defaultType: "balance",
  defaultSpin: "right",
  defaultSpecial: "",
  launchMode: "sling",
  sfx: true,
  replaySpeed: 2,
});
const loading = ref(true);
const saving = ref(false);
const savedAt = ref(0);
const error = ref("");

/* 戰績 */
interface MatchRow {
  opponent: string;
  myScore: number;
  oppScore: number;
  won: boolean;
  vsBot: boolean;
  finishedAt: string;
}
const record = ref<{ total: number; wins: number; losses: number; matches: MatchRow[] } | null>(null);

// 再編輯任何欄位就收掉「✓ 已儲存」，避免看起來像新改動也存了
watch(form, () => {
  savedAt.value = 0;
});

onMounted(async () => {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { settings: UserSettings };
    Object.assign(form, data.settings);
  } catch (e) {
    error.value = `載入失敗：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    loading.value = false;
  }
  // 戰績（失敗不擋設定頁）
  try {
    const res = await fetch("/api/me/matches");
    if (res.ok) record.value = (await res.json()) as typeof record.value;
  } catch {
    /* ignore */
  }
});

function matchTime(iso: string): string {
  // D1 datetime('now') 是 UTC、無時區標記 → 補 Z 再轉本地
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function save() {
  saving.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error === "nickname_required" ? "暱稱不能是空的" : (data.error ?? `HTTP ${res.status}`));
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
  <div class="settings">
    <section class="card">
      <h2>👤 個人設定</h2>
      <div v-if="loading" class="loading">載入中…</div>
      <template v-else>
        <div class="profile" v-if="auth.user.value">
          <img v-if="auth.user.value.picture" :src="auth.user.value.picture" class="avatar" alt="" referrerpolicy="no-referrer" />
          <div class="who">
            <div class="gname">{{ auth.user.value.name }}</div>
            <div class="gmail">{{ auth.user.value.email }}</div>
          </div>
        </div>

        <label class="row">
          <span>暱稱（對戰顯示用）</span>
          <input v-model="form.nickname" maxlength="20" placeholder="輸入暱稱" />
        </label>

        <div class="group-title">⚔️ 預設陀螺配置（進房自動套用）</div>
        <div class="grid2">
          <label class="row">
            <span>類型</span>
            <select v-model="form.defaultType">
              <option v-for="(label, key) in PRESET_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label class="row">
            <span>旋向</span>
            <select v-model="form.defaultSpin">
              <option value="right">↺ 逆時針（右旋）</option>
              <option value="left">↻ 順時針（左旋）</option>
            </select>
          </label>
          <label class="row">
            <span>必殺技</span>
            <select v-model="form.defaultSpecial">
              <option v-for="o in SPECIAL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
        </div>

        <div class="group-title">🎮 操作偏好</div>
        <div class="grid2">
          <label class="row">
            <span>發射模式</span>
            <select v-model="form.launchMode">
              <option value="sling">🏹 拉弓（拉的距離決定力道）</option>
              <option value="flick">🌀 甩動（放手瞬間速度決定）</option>
            </select>
          </label>
          <label class="row">
            <span>回放倍速</span>
            <select v-model.number="form.replaySpeed">
              <option :value="1">1x</option>
              <option :value="2">2x</option>
              <option :value="3">3x</option>
            </select>
          </label>
          <label class="row check">
            <input type="checkbox" v-model="form.sfx" />
            <span>音效</span>
          </label>
        </div>

        <div class="group-title">🏆 戰績</div>
        <template v-if="record && record.total > 0">
          <div class="rec-summary">
            <span class="rec-num win">{{ record.wins }} 勝</span>
            <span class="rec-num lose">{{ record.losses }} 敗</span>
            <span class="rec-num">共 {{ record.total }} 場</span>
            <span class="rec-num rate">勝率 {{ Math.round((record.wins / record.total) * 100) }}%</span>
          </div>
          <ul class="rec-list">
            <li v-for="(m, i) in record.matches" :key="i">
              <span class="rec-result" :class="m.won ? 'win' : 'lose'">{{ m.won ? "勝" : "敗" }}</span>
              <span class="rec-opp">vs {{ m.opponent }}<i v-if="m.vsBot" class="rec-bot">BOT</i></span>
              <span class="rec-score">{{ m.myScore }} : {{ m.oppScore }}</span>
              <span class="rec-time">{{ matchTime(m.finishedAt) }}</span>
            </li>
          </ul>
        </template>
        <p v-else class="hint">還沒有對戰紀錄——去大廳打一場吧！</p>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button class="primary" :disabled="saving" @click="save">{{ saving ? "儲存中…" : "💾 儲存設定" }}</button>
          <span v-if="savedAt && !error" class="saved">✓ 已儲存</span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 560px;
  margin: 0 auto;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 20px 22px;
}
.card h2 {
  margin: 0 0 14px;
}
.loading {
  color: var(--muted);
  padding: 20px 0;
}
.profile {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--line);
}
.gname {
  font-weight: 700;
}
.gmail {
  color: var(--muted);
  font-size: 12.5px;
}
.group-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--accent);
  margin: 18px 0 8px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--muted);
}
.row input[type="text"],
.row input:not([type]),
.row select {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 14px;
}
.row.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text);
  padding-top: 18px;
}
.row.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.hint {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.rec-summary {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.rec-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--muted);
}
.rec-num.win {
  color: #6ad08a;
}
.rec-num.lose {
  color: var(--red);
}
.rec-num.rate {
  color: var(--accent);
}
.rec-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}
.rec-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 11px;
  font-size: 13px;
}
.rec-result {
  font-weight: 800;
  flex-shrink: 0;
}
.rec-result.win {
  color: #6ad08a;
}
.rec-result.lose {
  color: var(--red);
}
.rec-opp {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rec-bot {
  font-style: normal;
  font-size: 10px;
  color: var(--blue);
  border: 1px solid var(--blue);
  border-radius: 5px;
  padding: 0 4px;
  margin-left: 6px;
}
.rec-score {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  flex-shrink: 0;
}
.rec-time {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}
.error {
  color: var(--red);
  font-size: 13px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
}
.actions .primary {
  background: var(--accent);
  color: #1a1207;
  border: 1px solid var(--accent);
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.actions .primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.saved {
  color: #6ad08a;
  font-size: 13.5px;
}
@media (max-width: 560px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
