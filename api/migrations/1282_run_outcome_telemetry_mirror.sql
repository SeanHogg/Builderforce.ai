-- 1282 · The uniform outcome row + telemetry label (PRD 35 §8.2, WS6) — the CORE-track
-- mirror of transactional-migrations/0025 + 0026.
--
-- 1281 shipped header-only on the reading that these relations live only on the
-- operational endpoint. They do in production, but `runTelemetryDatabase()` and
-- `resolveUsageDatabase()` resolve to THIS (core) handle wherever the operational
-- endpoint is not split out — local and tests — and both relations exist here
-- (llm_usage_log: 0001-era; run_model_outcomes: 0197/0283). Without these columns a
-- local or test write of the §8.2 row fails. Same convention as 1253 ↔ 0019.
--
-- Expand only, IF NOT EXISTS, nullable or defaulted: a no-op wherever the columns
-- already exist, and rows written before it stay valid. The 0025 backfill of
-- turn_index / tool_schema_tokens from metadata is NOT repeated here — core's
-- production copy of llm_usage_log is the drained legacy table.

-- ── llm_usage_log ────────────────────────────────────────────────────────────
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS entry_point VARCHAR(16);

-- ── run_model_outcomes ───────────────────────────────────────────────────────
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS entry_point VARCHAR(16);
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS compactions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS stall_recoveries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS escalations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS verify VARCHAR(8) NOT NULL DEFAULT 'not-run';
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS first_spawn_turn INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS covered_read_stubs INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS shell_file_reads INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS repo_errors INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS context_pack_tokens INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS model_preflight VARCHAR(32);
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS unkept_ready_claims INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS progress_trips JSONB;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS tokens INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
