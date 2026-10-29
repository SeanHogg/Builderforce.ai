-- 0025 · The uniform outcome row + the usage ledger's telemetry label (PRD 35 §8.2,
-- WS6) — the SINGLE home for this workstream's DDL. run_model_outcomes and the
-- write-side llm_usage_log live on THIS (operational / NEON_TRANSACTIONAL_DATABASE_URL)
-- track: run_model_outcomes was created here by 0013_run_telemetry.sql and the
-- agent-run usage writes land here. The primary track's coordinating header is
-- migrations/1281_run_outcome_telemetry.sql (no DDL there by design).
--
-- Expand now, contract in a later push: every column is additive + nullable (or
-- defaulted) so rows written before 0025 stay valid. No backfill beyond the two
-- derivable fills (turn_index, tool_schema_tokens) below.
-- See migrations/1253 + 0019 for the turn/tool-schema column meanings (mirrored
-- here from the core track).

-- ── llm_usage_log ────────────────────────────────────────────────────────────
-- entry_point — which entry point ran the call (vscode | web | rovr | canvas |
--   on-prem | cloud). A telemetry label only (§5 rule 3): never branched on for
--   behaviour. NULLABLE: today's cloud rows stamp 'cloud', the adapters stamp
--   their own at WS3/4/5.
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS entry_point VARCHAR(16);

-- turn_index / tool_schema_tokens exist in BOTH tracks but are always NULL today;
-- derive for old rows that carried them in metadata.
UPDATE llm_usage_log SET turn_index = (metadata->>'turnIndex')::int
  WHERE turn_index IS NULL AND metadata ? 'turnIndex';
UPDATE llm_usage_log SET tool_schema_tokens = (metadata->>'toolSchemaTokens')::int
  WHERE tool_schema_tokens IS NULL AND metadata ? 'toolSchemaTokens';

-- ── run_model_outcomes — the §8.2 uniform outcome row, one row per run, every ──
--   entry point. entry_point is the same telemetry label; the efficiency counters
--   the run state carried; verify the declared verify phase's coarse result.
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
