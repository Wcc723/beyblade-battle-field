<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useLobby } from "../composables/useLobby";

const router = useRouter();
const lobby = useLobby();

const roomCode = ref("");
const codeError = ref("");
const creating = ref(false);
const makePublic = ref(true);

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
    <section class="card">
      <div class="head-row">
        <h2>🏟️ 對戰大廳</h2>
        <span class="online" :class="{ off: !lobby.connected.value }">
          {{ lobby.connected.value ? `🟢 線上 ${lobby.online.value} 人` : lobby.authLost.value ? "" : "🔌 連線中…" }}
        </span>
      </div>
      <p v-if="lobby.authLost.value" class="auth-lost">
        ⚠️ 登入已過期，請<RouterLink to="/login">重新登入</RouterLink>後再回大廳。
      </p>

      <!-- 快速配對 -->
      <button class="quick" :class="{ queueing: lobby.queued.value }" :disabled="!lobby.connected.value" @click="toggleQueue">
        <template v-if="lobby.queued.value">⏳ 配對中（佇列 {{ lobby.queueSize.value }} 人）— 點擊取消</template>
        <template v-else>⚡ 快速配對</template>
      </button>

      <!-- 房號加入 -->
      <div class="join-row">
        <input
          v-model="roomCode"
          placeholder="輸入房號加入（例：AB12CD）"
          maxlength="6"
          @keyup.enter="joinByCode"
        />
        <button :disabled="!roomCode.trim()" @click="joinByCode">加入房間</button>
      </div>
      <p v-if="codeError" class="error">{{ codeError }}</p>

      <!-- 開房 -->
      <div class="actions">
        <button class="primary" :disabled="creating" @click="createRoom(false)">
          {{ creating ? "開房中…" : "➕ 開新房間" }}
        </button>
        <button class="bot" :disabled="creating" @click="createRoom(true)">🤖 跟 BOT 對戰</button>
      </div>
      <label class="pub-toggle">
        <input type="checkbox" v-model="makePublic" />
        <span>開新房間時在大廳公開（別人看得到、可直接加入）</span>
      </label>
    </section>

    <section class="card">
      <h3>公開房間（{{ lobby.rooms.value.length }}）</h3>
      <p v-if="lobby.rooms.value.length === 0" class="hint">目前沒有等人中的公開房間——開一間或用快速配對吧。</p>
      <ul v-else class="room-list">
        <li v-for="r in lobby.rooms.value" :key="r.code">
          <div class="room-info">
            <b class="room-host">{{ r.host }}</b>
            <span class="room-meta">#{{ r.code }} · {{ timeAgo(r.createdAt) }}</span>
          </div>
          <button class="join" @click="router.push({ name: 'room', params: { code: r.code } })">⚔️ 加入</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.lobby {
  display: grid;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
}
.card h2,
.card h3 {
  margin: 0 0 8px;
}
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.head-row h2 {
  margin: 0;
}
.online {
  font-size: 13px;
  color: #6ad08a;
  white-space: nowrap;
}
.online.off {
  color: var(--muted);
}
.auth-lost {
  background: rgba(255, 93, 93, 0.08);
  border: 1px solid rgba(255, 93, 93, 0.3);
  color: var(--red);
  border-radius: 9px;
  padding: 9px 12px;
  font-size: 13px;
  margin: 0 0 10px;
}
.auth-lost a {
  color: var(--accent);
}
.quick {
  width: 100%;
  background: var(--accent);
  color: #1a1207;
  border: 1px solid var(--accent);
  border-radius: 12px;
  padding: 13px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  margin-bottom: 12px;
}
.quick.queueing {
  background: rgba(255, 209, 102, 0.14);
  color: var(--accent);
}
.quick:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.join-row {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.join-row input {
  flex: 1;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 15px;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.error {
  color: var(--red);
  font-size: 13px;
  margin: -4px 0 10px;
}
.join-row button,
.actions button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.join-row button:disabled,
.actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.actions .primary {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
.actions .bot {
  border-color: var(--blue);
  color: var(--blue);
}
.pub-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
}
.pub-toggle input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}
.room-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.room-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.room-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.room-host {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-meta {
  font-size: 11.5px;
  color: var(--muted);
}
.join {
  background: var(--accent);
  color: #1a1207;
  border: none;
  border-radius: 9px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}
</style>
