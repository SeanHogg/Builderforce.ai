-- 0017 · Autovacuum tuning for the bounded-retention tables that are dual-resident (their
-- writers live on this operational endpoint; core holds the residue — see
-- migrations/1237 and sweptTablesBounded.ts). IF EXISTS keeps a database that never had
-- the table from failing the migration.
ALTER TABLE IF EXISTS usage_snapshots SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS run_model_outcomes SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS replay_visit_summaries SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS replay_releases SET (autovacuum_vacuum_scale_factor = 0.05);
