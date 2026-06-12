-- 出賽陣容（lineup）：JSON 陣列 [{"beyId":"...","special":"rush"},...] 至多 3 格。
-- NULL / 壞 JSON / 含未知 beyId → API 端回落 DEFAULT_LINEUP（src/game/beyblades.ts）。
ALTER TABLE user_settings ADD COLUMN lineup TEXT;
