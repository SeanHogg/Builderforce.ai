-- 1125 · Per-table autovacuum tuning for the log tables added to SWEPT_TABLES.
--
-- WHY. 1104 tuned the five log tables the registry knew about at the time. Since then
-- the registry gained eleven more relations on this endpoint, and every one of them
-- needs the same override for the same reason 1104 gives: at the default
-- `autovacuum_vacuum_scale_factor = 0.2`, autovacuum waits for 20% of the table to be
-- dead before it runs, which on an append-only feed means the relation EXTENDS instead
-- of reusing its pages, and retention reclaims nothing.
--
-- Two groups, added for two different reasons.
--
-- 1. NEVER SWEPT AT ALL. `pr_reconciliation_*` is the case that motivated this: the PR
--    reconciler writes a full snapshot of every open PR on every run and re-runs a repo
--    every ~4 minutes, so it had accumulated 1.42M rows — covering just 758 distinct PRs
--    — in a 1.84 GB relation, 66% of the database, with no retention policy of any kind.
--    The outbox, activity signals, Brain trace and connector sync log are the same shape
--    of unbounded append-only feed, found in the same audit.
--
-- 2. SWEPT ON ONE ENDPOINT ONLY. `llm_traces`, `llm_failover_log`, `llm_health_probes`
--    and `api_error_log` are tuned on the transactional endpoint by
--    transactional-migrations/0009 — but the relations also still EXIST here, left
--    behind when the writers moved to the transactional database (their last primary
--    rows are dated 2026-07-12/13, the split). The registry could name only one endpoint
--    per table, so these copies had no sweep and no tuning; they are now declared on both
--    and need the tuning on both. Their heap is small but permanent, and without the
--    override the tuning guard cannot tell "correct on the other endpoint" from
--    "forgotten on this one".
--
-- NO FILLFACTOR HERE, unlike 1104's `llm_traces`. Fillfactor reserves free space per page
-- for HOT updates, which pays off only on a relation whose rows are UPDATEd after insert.
-- Every table below is pure append EXCEPT `execution_lifecycle_outbox` (status/attempts
-- move as the row is delivered) and `pr_reconciliation_items` (`applied_action` is set
-- once when an action lands) — both of which update a narrow, non-indexed set of columns
-- a handful of times per row, far too little to justify permanently giving up 10% of the
-- storage this migration exists to reduce. The primary-side `llm_traces` gets none for a
-- simpler reason: it has no writer left at all.
--
-- These are storage parameters: they change no table's shape, so the schema-drift guard
-- sees nothing. Safe to re-run — ALTER TABLE ... SET is idempotent.

-- Group 1 — feeds that had no retention policy before this migration.
ALTER TABLE pr_reconciliation_items      SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE pr_reconciliation_errors     SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE pr_reconciliation_runs       SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE execution_lifecycle_outbox   SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE activity_signals             SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE brain_chat_trace             SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE integration_sync_logs        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);

-- Group 2 — the primary-side copies of relations 0009 already tuned on transactional.
ALTER TABLE llm_traces                   SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE llm_failover_log             SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE llm_health_probes            SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE api_error_log                SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                              autovacuum_analyze_scale_factor = 0.02);
