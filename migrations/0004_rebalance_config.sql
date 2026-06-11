-- 平衡第二輪（2026-06：傷害浮動 ±10% + 同步死亡 tie-break + 重校）後，
-- global_config 內存的舊場地/屬性 blob 會蓋過程式碼新預設 → 一律清除、回落新預設。
-- 注意：這會重置管理員在「線上設定(D1)」存過的全域場地/屬性/必殺技數值；
-- 後台重新儲存即可再自訂（新預設：hpBase 1100、collisionSpinLoss 1.36、
-- spinDecayBase 56、knockback 1.8、spinKnockback 0.14、ringOutSpeed 160）。
DELETE FROM global_config WHERE key IN ('arena', 'stats', 'special');
