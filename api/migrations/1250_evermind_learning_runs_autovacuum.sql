-- 1250 · evermind_learning_runs joins the bounded-retention sweep (sweptTablesBounded.ts).
--
-- 1240 created one row per text-learn with no window, so the ledger grew without
-- bound. It is now purged at 90 days (runs with a still-pending candidate are kept).
-- Same tuning as 1237: 0.05 lets autovacuum reclaim pages after each nightly bounded
-- purge. IF EXISTS: a fresh database that never created the table must not abort.
-- Guarded by scripts/check-swept-tables.mjs.
ALTER TABLE IF EXISTS evermind_learning_runs SET (autovacuum_vacuum_scale_factor = 0.05);
