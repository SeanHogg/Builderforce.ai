-- 1126 · Autovacuum tuning for `execution_rollbacks`, newly added to SWEPT_TABLES.
--
-- Same reasoning as 1104/1125: at the default `autovacuum_vacuum_scale_factor = 0.2` an
-- append-only feed extends rather than reusing pages, so retention reclaims nothing. This
-- table held 18,199 rows in 24 MB — all of them already past the 30-day window, the
-- residue of the runaway dispatch loop — with no policy of any kind.
--
-- `activity_signals` and `integration_sync_logs` are NOT re-stated here: 1125 already
-- tuned them, and this migration only narrows their retention window, which is a code
-- change in the registry rather than a storage parameter.
--
-- Storage parameters only: no table shape changes, so the schema-drift guard sees
-- nothing. Safe to re-run.
ALTER TABLE execution_rollbacks SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                     autovacuum_analyze_scale_factor = 0.02);
