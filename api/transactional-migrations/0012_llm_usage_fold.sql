-- 0012 · OPERATIONAL mirror of migrations/1180 — see that file for the full reasoning.
--
-- This is the endpoint that actually matters for both relations: `llm_usage_log` and
-- `ingestion_usage_log` are written through `usageDatabaseOf(db)` / the operational
-- sibling, so the copies on the primary database have no writer while this one takes a
-- row per LLM call. The split exists only because the two runners never cross.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS calls INTEGER NOT NULL DEFAULT 1;

ALTER TABLE llm_usage_log       SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                     autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE ingestion_usage_log SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                     autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);

-- `activity_log` joins the registry too, as a VACUUM-ONLY member: it has been deleted
-- from (the 90-day anonymous-visitor window, migration 1111) with nothing vacuuming it
-- afterwards, which is retention-without-a-vacuum — the shape that left 46k live
-- `manager_actions` rows inside 593 MB. It is marked `reclaimable: false` in the registry
-- so the weekly rewrite never takes an ACCESS EXCLUSIVE lock on the audit trail; the
-- tuning below is what makes the daily plain vacuum actually keep up.
ALTER TABLE activity_log        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                     autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_day ON llm_usage_log ((created_at::date));
