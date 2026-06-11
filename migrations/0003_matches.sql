-- Phase 5：戰績（每場 finished 寫一筆；BOT 對手 uid 為 NULL + vs_bot=1）
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  a_uid INTEGER,
  b_uid INTEGER,
  a_nickname TEXT NOT NULL,
  b_nickname TEXT NOT NULL,
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  winner_side TEXT NOT NULL,            -- 'A' | 'B'（finished 必有勝者）
  vs_bot INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_matches_a ON matches(a_uid, id);
CREATE INDEX IF NOT EXISTS idx_matches_b ON matches(b_uid, id);
