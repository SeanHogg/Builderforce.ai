-- 1104 · Per-table autovacuum tuning for the retention-swept log tables.
--
-- WHY. `autovacuum_vacuum_scale_factor` defaults to 0.2 — autovacuum waits until 20%
-- of the table is dead tuples before it runs. On a low-write table that is fine. On
-- this platform's log feeds it is not: `manager_actions` takes a row every manager
-- pass, so 20% of a large table is an enormous absolute number of dead tuples, the
-- vacuum arrives far too late, and in the meantime the relation EXTENDS rather than
-- reusing pages. That is how it reached 593 MB holding 46k live rows (~24 MB of real
-- data) and put the database over the Neon Free 512 MB ceiling.
--
-- 0.02 (2%) plus a small absolute threshold makes autovacuum track these tables
-- closely, which is what stops the bloat being re-earned between the daily
-- `VACUUM (ANALYZE)` sweep and the weekly reclaim (application/maintenance/
-- tableMaintenance.ts). The three settings are complementary, not alternatives:
-- autovacuum keeps pages reusable, the daily vacuum keeps the free-space map and the
-- planner statistics current, and only the weekly `VACUUM (FULL)` returns space to
-- the OS.
--
-- FILLFACTOR is applied to `llm_traces` ONLY, and that is deliberate. Fillfactor
-- reserves free space on each page for future HOT updates; `llm_traces` is the one
-- relation here whose rows are UPDATEd after insert (a stream finalises its row), so
-- it benefits. Every other table is pure append — reserving 10% of every page there
-- would permanently waste 10% of the storage this migration exists to reduce.
--
-- These are storage parameters: they do not change the shape of any table, so the
-- schema-drift guard sees nothing, and they apply to the PRIMARY database only. The
-- `llm_*` and `api_error_log` relations live on the transactional endpoint and are
-- tuned by the mirror of this file in transactional-migrations/.
--
-- ALTER TABLE ... SET (...) is transactional DDL, so it applies cleanly inside the
-- migration runner's per-file transaction. VACUUM itself cannot run in a transaction
-- and therefore is NOT here — the cron sweeps own it.

ALTER TABLE manager_actions   SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE tool_audit_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE error_events      SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE qa_journey_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE demo_events       SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
