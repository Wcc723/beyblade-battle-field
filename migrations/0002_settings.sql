-- Phase 3：個人設定 + 全域遊戲設定（管理員調的場地/陀螺/必殺技）

-- 全域設定：key-value JSON blob（結構與前端 localStorage 同形 → 零轉換、加欄位免 migration）
-- key ∈ 'arena'（{presets, activeId}）/ 'stats'（四類型屬性）/ 'special'（必殺技數值）
CREATE TABLE IF NOT EXISTS global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 個人設定（1:1 users）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '',
  default_type TEXT NOT NULL DEFAULT 'balance',     -- attack | defense | stamina | balance
  default_spin TEXT NOT NULL DEFAULT 'right',       -- right | left
  default_special TEXT NOT NULL DEFAULT '',         -- '' | rush | blast | dash | vortex | clone
  launch_mode TEXT NOT NULL DEFAULT 'sling',        -- flick | sling
  sfx INTEGER NOT NULL DEFAULT 1,
  replay_speed REAL NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
