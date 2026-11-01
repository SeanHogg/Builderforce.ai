-- 1292 · Partial index for the scheduled-report probe (expand only, 1 index).
--
-- cronWorkSignal's SCHEDULE_SOURCES publishes the earliest armed `report_schedules.next_run_at` to the KV gate at the end of every
-- active tick, as two scalar subqueries: `SELECT MIN(next_run_at) FROM report_schedules WHERE is_enabled = true AND next_run_at IS
-- NOT NULL` (the second adds a lower bound on next_run_at). report_schedules has no index on next_run_at (0068a created only
-- idx_report_schedules_segment, 0461 added (tenant_id, subject_kind, subject_ref)), neither of which can serve a cross-tenant MIN
-- over run time, so the probe would scan the table on every active tick. This partial index (mirroring idx_workflow_triggers_due,
-- 0080) holds exactly the armed rows, so the probe is a top-of-index read. The probe's WHERE is the index predicate verbatim (the
-- flag is `is_enabled = true`, from SCHEDULE_SOURCES' `flagged`; the probe adds next_run_at IS NOT NULL). runDueReports does NOT
-- use it: its read is `is_enabled = true AND (next_run_at IS NULL OR next_run_at <= now)`, and the NULL arm (a schedule never run)
-- is outside this predicate. The index is for the gate probe only.
-- Adds an index only: nothing the old Worker runs depends on it. A plain CREATE INDEX takes a SHARE lock on report_schedules
-- (blocking writes) while it builds; migrate.mjs runs the file as one transaction, so `SET LOCAL lock_timeout` bounds the wait for
-- that lock and a timeout rolls the file back and fails the deploy cleanly (re-run it). Reversible by DROP INDEX.
SET LOCAL lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS idx_report_schedules_due
  ON report_schedules (next_run_at)
  WHERE is_enabled = true AND next_run_at IS NOT NULL;
