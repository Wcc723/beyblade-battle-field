-- 時長平衡重校（2026-06：戰局 20~30 秒、會心 1.5x、分招開場緩衝、漩渦 buff、命名改風）後，
-- global_config 舊 blob（hpBase 1100 / collisionSpinLoss 1.28 / 舊 special 數值）會蓋過新預設 → 清除回落。
-- beys（個體覆寫）為差異值、疊在新基礎上仍合理，保留不清。
-- 注意：這會重置管理員存過的全域場地/屬性/必殺技與 enabledIds 勾選，後台重存即可。
DELETE FROM global_config WHERE key IN ('arena', 'stats', 'special');
