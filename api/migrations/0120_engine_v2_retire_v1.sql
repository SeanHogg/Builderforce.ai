-- 0120_engine_v2_retire_v1.sql
-- V1 RETIRED (operator decision 2026-06-13): `builderforce-v2` (the Claude Agent SDK
-- runner, gateway-routed — drives the vendor pool, no tenant BYO key) is the consolidated
-- engine on every surface. The on-prem relay `runV1Engine` is deleted and `DEFAULT_ENGINE_ID`
-- is now `builderforce-v2`; this migration aligns persisted state:
--   1. back-fill any legacy `builderforce-v1` agent rows to `builderforce-v2`
--   2. flip the column default (was `builderforce-v1` in migration 0087)
UPDATE ide_agents SET engine = 'builderforce-v2' WHERE engine = 'builderforce-v1';
ALTER TABLE ide_agents ALTER COLUMN engine SET DEFAULT 'builderforce-v2';
