<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useLobby } from "../composables/useLobby";
import BbIcon from "../components/ui/BbIcon.vue";

const router = useRouter();
const lobby = useLobby();

const roomCode = ref("");
const codeError = ref("");
const creating = ref(false);
const makePublic = ref(true);

// 沒有其他玩家可對戰（只有自己在線、無公開房、未在排隊）→ 凸顯「跟 BOT 對戰」
const noOpponents = computed(
  () =>
    lobby.connected.value &&
    lobby.online.value <= 1 &&
    lobby.rooms.value.length === 0 &&
    !lobby.queued.value,
);

// 「X 秒前」要會動：rooms 不變時也每 30 秒重算一次
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  lobby.connect();
  nowTimer = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  clearInterval(nowTimer);
  lobby.dispose();
});

// 快速配對成功 → 跳進配好的房
watch(lobby.matchedCode, (code) => {
  if (code) router.push({ name: "room", params: { code } });
});

function joinByCode() {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) return;
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    codeError.value = "房號格式：6 位英數（例：AB12CD）";
    return;
  }
  codeError.value = "";
  // 具名路由 + params → 自動 URL 編碼，不會拼出壞路徑
  router.push({ name: "room", params: { code } });
}

async function createRoom(bot = false) {
  creating.value = true;
  codeError.value = "";
  try {
    const res = await fetch("/api/room/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public: !bot && makePublic.value }), // BOT 房不上公開列表
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code } = (await res.json()) as { code: string };
    router.push({ name: "room", params: { code }, query: bot ? { bot: "1" } : undefined });
  } catch {
    codeError.value = "開房失敗，請再試一次";
  } finally {
    creating.value = false;
  }
}

function toggleQueue() {
  lobby.queued.value ? lobby.unqueue() : lobby.enqueue();
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((now.value - ts) / 1000));
  if (s < 60) return `${s} 秒前`;
  return `${Math.floor(s / 60)} 分鐘前`;
}
</script>

<template>
  <div class="lobby">
    <!-- 主控面板：配對 / 房號加入 / 開房 -->
    <section class="plate plate--rivets panel">
      <div class="head-row">
        <h2 class="f-label">對戰大廳</h2>
        <div class="pills">
          <!-- 線上人數金屬章 -->
          <span v-if="lobby.connected.value" class="pill">
            <BbIcon name="people" :size="14" class="pic pic--ok" />
            <b>{{ lobby.online.value }}</b>
            <span class="pill-unit">人在線</span>
          </span>
          <!-- 連線狀態金屬章 -->
          <span
            class="pill"
            :class="lobby.connected.value ? 'pill--on' : lobby.authLost.value ? 'pill--lost' : 'pill--off'"
          >
            <BbIcon name="wifi" :size="14" class="pic" />
            {{ lobby.connected.value ? "連線正常" : lobby.authLost.value ? "已斷線" : "連線中…" }}
          </span>
        </div>
      </div>

      <p v-if="lobby.authLost.value" class="auth-lost">
        <span class="f-badge f-badge--red">登入逾期</span>
        <span>登入已過期，請<RouterLink to="/login">重新登入</RouterLink>後再回大廳。</span>
      </p>

      <!-- 快速配對：整頁最大 CTA；排隊中切換成充能斜紋 + 取消排隊 -->
      <button
        class="f-btn f-btn--primary quick"
        :class="{ queueing: lobby.queued.value }"
        :disabled="!lobby.connected.value"
        @click="toggleQueue"
      >
        <template v-if="lobby.queued.value">
          <BbIcon name="hourglass" :size="18" />
          <span>取消排隊</span>
          <span class="quick-en">佇列 {{ lobby.queueSize.value }} 人</span>
        </template>
        <template v-else>
          <BbIcon name="lightning" :size="20" />
          <span>快速配對</span>
          <span class="quick-en">QUICK MATCH</span>
        </template>
      </button>

      <!-- 房號加入 -->
      <div class="join-row">
        <input
          v-model="roomCode"
          class="f-input code-input"
          placeholder="輸入房號"
          maxlength="6"
          aria-label="輸入房號"
          @keyup.enter="joinByCode"
        />
        <button class="f-btn join-btn" :disabled="!roomCode.trim()" @click="joinByCode">
          <BbIcon name="door-open" :size="16" />加入
        </button>
      </div>
      <p v-if="codeError" class="error">
        <span class="f-badge f-badge--red">錯誤</span>{{ codeError }}
      </p>

      <!-- 沒有其他玩家時的提示：引導去打 BOT -->
      <p v-if="noOpponents" class="bot-nudge">
        <BbIcon name="lightning" :size="13" />目前沒有其他玩家在線 — 先跟 BOT 練一場吧
      </p>
      <!-- 開房 -->
      <div class="actions" :class="{ 'actions--bot-hot': noOpponents }">
        <button class="f-btn f-btn--ghost act-btn" :disabled="creating" @click="createRoom(false)">
          <BbIcon name="plus" :size="16" />{{ creating ? "開房中…" : "建立房間" }}
        </button>
        <button
          class="f-btn act-btn bot-btn"
          :class="noOpponents ? 'bot-btn--hot' : 'f-btn--ghost'"
          :disabled="creating"
          @click="createRoom(true)"
        >
          <BbIcon name="controller" :size="16" />跟 BOT 對戰
        </button>
      </div>
      <!-- 公開房間勾選：金屬方形勾選鍵 -->
      <label class="pub-toggle">
        <input v-model="makePublic" type="checkbox" class="pub-check" />
        <span class="pub-box" aria-hidden="true"><BbIcon name="check" :size="12" /></span>
        <span class="pub-txt">開新房間時在大廳公開（別人看得到、可直接加入）</span>
      </label>
    </section>

    <!-- 公開房間列表 -->
    <section class="plate plate--rivets panel">
      <h3 class="f-label">公開房間（{{ lobby.rooms.value.length }}）</h3>
      <!-- 空狀態：鋼板銘文 -->
      <div v-if="lobby.rooms.value.length === 0" class="empty">
        <p class="empty-title">目前沒有公開房間</p>
        <p class="empty-sub">開一間或用快速配對吧</p>
      </div>
      <ul v-else class="room-list">
        <li v-for="r in lobby.rooms.value" :key="r.code" class="plate room-card">
          <span class="room-code">{{ r.code }}</span>
          <span class="room-meta">
            <span class="room-host"><span class="host-tag">房主</span>{{ r.host }}</span>
            <span class="room-sub">
              <span class="f-badge f-badge--amber wait">等待中</span>
              <span class="ago">{{ timeAgo(r.createdAt) }}</span>
            </span>
          </span>
          <button class="f-btn room-join" @click="router.push({ name: 'room', params: { code: r.code } })">
            加入<BbIcon name="arrow-right" :size="14" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.lobby {
  display: grid;
  gap: 16px;
  max-width: 480px;
  margin: 0 auto;
}

/* ---- 面板頭列：標題 + 狀態章 ---- */
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.head-row .f-label {
  margin: 0;
}
.pills {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
/* 金屬章：切角鐵牌 + 頂部高光 */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px 5px 9px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--steel);
  white-space: nowrap;
  background: linear-gradient(180deg, #23272f, #14171d);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}
.pill b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 14px;
  line-height: 1;
  letter-spacing: 0.05em;
  color: #fff;
}
.pill-unit {
  letter-spacing: 0.1em;
}
.pic--ok {
  color: var(--ok);
}
.pill--on .pic {
  color: var(--accent);
}
.pill--off {
  color: var(--muted);
}
.pill--lost {
  color: var(--red);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(232, 68, 46, 0.4);
}

/* ---- 登入逾期警示列 ---- */
.auth-lost {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--text);
  background: rgba(232, 68, 46, 0.07);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 0 0 1px rgba(232, 68, 46, 0.35);
}
.auth-lost a {
  color: var(--accent);
}

/* ---- 快速配對：滿版大機台鍵 ---- */
.quick {
  width: 100%;
  min-height: 56px;
  padding: 15px 18px;
  font-size: 19px;
  letter-spacing: 0.24em;
  text-indent: 0.1em;
  margin-bottom: 12px;
}
.quick-en {
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.3em;
  opacity: 0.78;
  text-indent: 0;
}
/* 排隊中：琥珀充能斜紋流動（取代琥珀鍵面） */
.quick.queueing,
.quick.queueing:hover {
  color: var(--accent);
  text-shadow: none;
  background:
    repeating-linear-gradient(-45deg, rgba(255, 179, 31, 0.16) 0 12px, transparent 12px 24px),
    linear-gradient(180deg, #262b34, #15181e 55%, #101319);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(255, 179, 31, 0.4);
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.85)) drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4));
  animation: chargeFlow 0.8s linear infinite;
}
/* -45 度、24px 週期的斜紋 → 水平位移 24×√2 ≈ 33.94px 可無縫循環 */
@keyframes chargeFlow {
  to {
    background-position: 33.94px 0, 0 0;
  }
}

/* ---- 房號加入 ---- */
.join-row {
  display: flex;
  gap: 10px;
  margin: 0 0 12px;
}
.code-input {
  flex: 1;
  min-width: 0;
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
.code-input::placeholder {
  font-family: var(--f-b);
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: none;
}
.join-btn {
  flex: none;
  letter-spacing: 0.2em;
  padding: 10px 16px;
}
.error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 0 12px;
  font-size: 12.5px;
  color: var(--red);
}

/* ---- 開房動作列 ---- */
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.act-btn {
  flex: 1 1 auto;
}
.bot-btn,
.bot-btn:hover {
  color: var(--blue);
}
/* 沒玩家時凸顯：藍鍵面填滿 + 發光脈動 + 佔更大寬度 */
.actions--bot-hot .bot-btn {
  flex: 1.7 1 auto;
}
.bot-btn--hot,
.bot-btn--hot:hover {
  color: var(--white-hot);
  background: linear-gradient(180deg, #2e9fe8, #14629c);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  animation: botPulse 1.5s ease-in-out infinite;
}
@keyframes botPulse {
  0%,
  100% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 0 0 1px rgba(120, 200, 255, 0.5);
  }
  50% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 0 0 2px rgba(160, 220, 255, 0.95);
  }
}
/* 沒玩家提示小字 */
.bot-nudge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 10px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--blue);
}
.bot-nudge .bb-icon {
  color: var(--accent);
}

/* ---- 公開房間勾選：金屬方形勾選鍵 ---- */
.pub-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  margin-top: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.pub-check {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.pub-box {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: transparent;
  background: linear-gradient(180deg, #0b0d12, #14171e 80%);
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(170, 180, 196, 0.25);
  transition: color 0.12s, box-shadow 0.12s;
}
.pub-check:checked + .pub-box {
  color: var(--accent);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(255, 179, 31, 0.55);
}
.pub-check:focus-visible + .pub-box {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.pub-txt {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
}

/* ---- 公開房間列表 ---- */
.room-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.room-card {
  --cut: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px 11px 14px;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
}
.room-code {
  flex: none;
  min-width: 92px;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 21px;
  letter-spacing: 0.18em;
  color: var(--white-hot);
  text-shadow: 0 0 10px rgba(255, 179, 31, 0.35);
}
.room-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.room-host {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.host-tag {
  color: var(--muted);
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.2em;
  margin-right: 5px;
}
.room-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wait {
  font-size: 10px;
  padding: 1px 7px;
}
/* 等待中：琥珀菱形呼吸燈 */
.wait::before {
  content: "";
  width: 5px;
  height: 5px;
  background: var(--accent);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  animation: waitPulse 1.2s infinite;
}
@keyframes waitPulse {
  50% {
    opacity: 0.25;
  }
}
.ago {
  font-size: 10.5px;
  color: var(--muted);
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.room-join {
  flex: none;
  min-height: 40px;
  padding: 8px 13px;
  font-size: 13px;
  letter-spacing: 0.2em;
  gap: 6px;
}

/* ---- 空狀態：鋼板銘文 ---- */
.empty {
  padding: 26px 12px 24px;
  text-align: center;
  background:
    repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.012) 0 3px, transparent 3px 9px),
    linear-gradient(180deg, #171a21, #11141a);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), inset 0 0 0 1px rgba(50, 56, 69, 0.6);
}
.empty-title {
  margin: 0;
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
  color: #525b6b;
  /* 蝕刻感：上亮下暗 */
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.06), 0 -1px 1px rgba(0, 0, 0, 0.8);
}
.empty-sub {
  margin: 7px 0 0;
  font-size: 11.5px;
  letter-spacing: 0.2em;
  color: var(--muted);
}

/* ---- 窄螢幕：房卡縮一級 ---- */
@media (max-width: 379.98px) {
  .room-code {
    min-width: 82px;
    font-size: 18px;
  }
  .room-card {
    gap: 9px;
  }
}
</style>
