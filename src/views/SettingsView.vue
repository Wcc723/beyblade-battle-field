<script setup lang="ts">
// Phase 3 將接上：暱稱+頭像（Google 預設）、預設陀螺配置（類型+必殺技）、
// 操作偏好（發射模式/音效/回放倍速）、戰績紀錄（D1）。
</script>

<template>
  <div class="settings">
    <section class="card">
      <h2>👤 個人設定</h2>
      <p class="hint">登入（Google OAuth）與個人設定將在後續階段接上。規劃內容：</p>
      <ul class="todo">
        <li>暱稱與頭像（預設取 Google 帳號）</li>
        <li>預設陀螺配置：類型 + 必殺技，進房直接套用</li>
        <li>操作偏好：發射模式（甩動/拉弓）、音效、回放倍速</li>
        <li>戰績紀錄：勝敗場與對戰歷史</li>
      </ul>
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
  padding: 18px 20px;
}
.card h2 {
  margin: 0 0 8px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
}
.todo {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--text);
  font-size: 14px;
  line-height: 2;
}
</style>
