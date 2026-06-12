<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "../store/authStore";
import BbIcon from "../components/ui/BbIcon.vue";

const auth = useAuth();
const router = useRouter();

/** 登出（從全站 header 搬到這裡）：清 session 後回登入頁 */
async function onLogout() {
  await auth.logout();
  router.push("/login");
}

interface UserSettings {
  nickname: string;
  defaultType: string;
  defaultSpin: string;
  defaultSpecial: string;
  launchMode: string;
  sfx: boolean;
  replaySpeed: number;
  /** 出賽陣容（編輯入口在 /roster；PUT 全量必須帶回，缺了 worker 會重設成預設陣容） */
  lineup?: { beyId: string; special: string }[];
}

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
    <section class="plate plate--rivets card">
      <h2 class="page-title"><BbIcon name="person-circle" :size="18" />個人設定</h2>
      <div v-if="loading" class="loading">載入中…</div>
      <template v-else>
        <div class="profile" v-if="auth.user.value">
          <span class="avatar-frame">
            <img
              v-if="auth.user.value.picture"
              :src="auth.user.value.picture"
              class="avatar"
              alt=""
              referrerpolicy="no-referrer"
            />
            <BbIcon v-else name="person" :size="22" />
          </span>
          <div class="who">
            <div class="gname">{{ auth.user.value.name }}</div>
            <div class="gmail">{{ auth.user.value.email }}</div>
          </div>
          <span v-if="auth.isAdmin.value" class="f-badge f-badge--amber admin-badge">
            <BbIcon name="shield" :size="11" />管理員
          </span>
        </div>
        <div class="hazard hazard--thin"></div>

        <label class="row nick-row">
          <span class="row-label">暱稱（對戰顯示用）</span>
          <input v-model="form.nickname" maxlength="20" placeholder="輸入暱稱" class="f-input" />
        </label>
        <p class="hint">未改名前使用系統指派的代號，隨時可以改成自己的名字。</p>

        <div class="f-label sect"><BbIcon name="controller" :size="13" />操作偏好</div>
        <div class="grid2">
          <label class="row">
            <span class="row-label">發射模式</span>
            <span class="f-select">
              <select v-model="form.launchMode">
                <option value="sling">拉弓（拉的距離決定力道）</option>
                <option value="flick">甩動（放手瞬間速度決定）</option>
              </select>
            </span>
          </label>
          <label class="row">
            <span class="row-label">回放倍速</span>
            <span class="f-select">
              <select v-model.number="form.replaySpeed">
                <option :value="1">1x</option>
                <option :value="2">2x</option>
                <option :value="3">3x</option>
              </select>
            </span>
          </label>
          <label class="row check">
            <input type="checkbox" v-model="form.sfx" />
            <BbIcon :name="form.sfx ? 'volume-up' : 'volume-mute'" :size="15" />
            <span>音效</span>
          </label>
        </div>

        <div class="f-label sect"><BbIcon name="trophy" :size="13" />戰績</div>
        <template v-if="record && record.total > 0">
          <div class="stats-band">
            <BbIcon name="trophy" :size="24" class="band-ic" />
            <div class="stats-num">
              <b>{{ record.wins }}</b><i>勝</i>
              <b class="lose">{{ record.losses }}</b><i>敗</i>
              <i class="total">共 {{ record.total }} 場</i>
            </div>
            <div class="winrate">
              <b>{{ Math.round((record.wins / record.total) * 100) }}%</b>
              <span>WIN RATE</span>
            </div>
          </div>
          <div class="wr-bar">
            <b :style="{ width: Math.round((record.wins / record.total) * 100) + '%' }"></b>
          </div>
          <ul class="rec-list">
            <li v-for="(m, i) in record.matches" :key="i">
              <span class="f-badge res-badge" :class="m.won ? 'f-badge--ok' : 'f-badge--red'">
                {{ m.won ? "勝" : "敗" }}
              </span>
              <span class="rec-opp">
                <span class="vs">VS</span>{{ m.opponent }}
                <span v-if="m.vsBot" class="f-badge f-badge--blue bot-tag"><BbIcon name="controller" :size="10" />BOT</span>
              </span>
              <span class="rec-score">{{ m.myScore }} : {{ m.oppScore }}</span>
              <span class="rec-time">{{ matchTime(m.finishedAt) }}</span>
            </li>
          </ul>
        </template>
        <p v-else class="hint">還沒有對戰紀錄——去大廳打一場吧！</p>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button class="f-btn f-btn--primary" :disabled="saving" @click="save">
            <BbIcon name="floppy" :size="15" />{{ saving ? "儲存中…" : "儲存設定" }}
          </button>
          <span v-if="savedAt && !error" class="saved"><BbIcon name="check" :size="14" />已儲存</span>
        </div>

        <!-- 登出（從全站 header 搬到個人設定底部） -->
        <div class="hazard hazard--thin logout-sep"></div>
        <button class="f-btn f-btn--danger logout-btn" @click="onLogout">
          <BbIcon name="box-arrow-right" :size="15" />登出
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 480px;
  margin: 0 auto;
}
.card {
  padding: 16px 14px 18px;
}
/* ---- 頁標 ---- */
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
/* ---- Google 帳號列 ---- */
.profile {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.avatar-frame {
  /* 切角金屬框（與 plate 同語彙），頭像 / 預設 person 圖示都收在框內 */
  width: 48px;
  height: 48px;
  flex: none;
  display: grid;
  place-items: center;
  padding: 2px;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  background: linear-gradient(180deg, #4d5564, #23272f 45%, #0d1016);
  box-shadow: inset 0 0 0 1px rgba(255, 122, 24, 0.35);
  color: var(--steel);
}
.avatar-frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
}
.who {
  flex: 1;
  min-width: 0;
}
.gname {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 16px;
  letter-spacing: 0.07em;
}
.gmail {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-badge {
  flex: none;
}
/* ---- 表單 ---- */
.nick-row {
  margin-top: 12px;
}
.sect {
  margin-top: 18px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.row-label {
  font-size: 11.5px;
  color: var(--muted);
  letter-spacing: 0.06em;
}
.row.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
}
.row.check input {
  width: 17px;
  height: 17px;
  accent-color: var(--accent);
}
.row.check .bb-icon {
  color: var(--accent);
}
/* ---- 低調鋼板提示小字 ---- */
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
/* ---- 戰績計數板（金屬熔光帶） ---- */
.stats-band {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background:
    linear-gradient(90deg, rgba(255, 122, 24, 0.14), transparent 60%),
    linear-gradient(180deg, #10131a, #0b0d12);
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
  box-shadow: inset 0 0 0 1px rgba(255, 179, 31, 0.16);
}
.band-ic {
  flex: none;
  color: var(--accent);
  filter: drop-shadow(0 0 8px rgba(255, 179, 31, 0.5));
}
.stats-num {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.stats-num b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  color: var(--white-hot);
  font-variant-numeric: tabular-nums;
}
.stats-num b.lose {
  color: var(--red);
}
.stats-num i {
  font-style: normal;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.18em;
}
.stats-num i.total {
  margin-left: 2px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.winrate {
  flex: none;
  text-align: right;
}
.winrate b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 21px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.winrate span {
  display: block;
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 9px;
  letter-spacing: 0.3em;
  color: var(--muted);
}
.wr-bar {
  height: 4px;
  margin-top: 8px;
  background: #05060a;
  overflow: hidden;
  display: flex;
}
.wr-bar b {
  background: linear-gradient(90deg, var(--lava), var(--accent));
  box-shadow: 0 0 8px rgba(255, 122, 24, 0.6);
}
/* ---- 戰績清單 ---- */
.rec-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 280px;
  overflow-y: auto;
}
.rec-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  font-size: 12.5px;
  background: linear-gradient(180deg, #171a21, #11141a);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.res-badge {
  flex: none;
  letter-spacing: 0;
}
.rec-opp {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.rec-opp .vs {
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--muted);
  margin-right: 5px;
}
.bot-tag {
  font-size: 9px;
  padding: 1px 5px;
  gap: 3px;
  margin-left: 6px;
  vertical-align: 1px;
}
.rec-score {
  flex: none;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 16px;
  letter-spacing: 0.08em;
  color: var(--white-hot);
  font-variant-numeric: tabular-nums;
}
.rec-time {
  flex: none;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--muted);
}
/* ---- 錯誤 / 儲存 ---- */
.error {
  color: var(--red);
  font-size: 13px;
  margin: 12px 0 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
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
/* ---- 登出（頁尾低調區） ---- */
.logout-sep {
  margin-top: 22px;
}
.logout-btn {
  margin-top: 14px;
  font-size: 13px;
  padding: 8px 14px;
}
@media (max-width: 420px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
