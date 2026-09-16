-- 1180 · Make `llm_usage_log` foldable, and bring it (with `ingestion_usage_log`) into
-- the retention-swept set.
--
-- WHY. These two are the operational endpoint's only unbounded relations with NO
-- retention policy at all: `llm_usage_log` takes a row per LLM call and
-- `ingestion_usage_log` a row per repo/integration import, and neither was in
-- SWEPT_TABLES, so neither was ever purged OR vacuumed. That is how the endpoint
-- reached 86.5% of the Neon Free 512 MB branch ceiling.
--
-- `calls` IS THE FOLD'S ROW COUNT. The ledger cannot simply be purged — it is the
-- billing record — so past `LLM_USAGE_ROLLUP_AFTER_DAYS` a day of calls is folded
-- IN PLACE to one row per (tenant, day, user, model, project, task, execution, chat,
-- …): every dimension any reader groups by survives, and every figure any reader sums
-- (tokens, cache tiers, cost, retries) is summed into the surviving row, so the totals
-- come out identical. The one quantity a fold destroys is the number of ROWS, which is
-- how "requests" was counted — so it becomes a column, defaulting to 1 for every row
-- written before and after the fold, and `SUM(calls)` replaces `COUNT(*)` at every
-- request-count read (`usageRequestCount()` in application/llm/usageLedger.ts).
--
-- MIRRORED ON THE OPERATIONAL TRACK by transactional-migrations/0012. The relation
-- exists on both endpoints and the two runners never cross — see the
-- llm_usage_log-in-two-tracks rule.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS calls INTEGER NOT NULL DEFAULT 1;

-- Per-table autovacuum tuning, required of every SWEPT_TABLES member by
-- `npm run check:swept-tables`. The 0.2 default is far too lax for a per-call feed:
-- autovacuum arrives only after the relation has already extended rather than reused
-- its pages, which is the exact mechanism that produced the 593 MB `manager_actions`
-- relation. No fillfactor: both relations are pure-append, and reserving 10% of every
-- page would permanently waste the storage this is here to reclaim.
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

-- The fold groups a whole calendar day by every dimension column and deletes that day's
-- source rows; both halves are driven off `created_at`, so the day scan is the index it
-- needs. Partial on `calls = 1` would be wrong — a re-fold has to find folded rows too.
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_day ON llm_usage_log ((created_at::date));
