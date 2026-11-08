-- The dedupe key for board-imported applications (column added in 1323).
--
-- Partial: only rows that HAVE a board id participate, so every platform-made
-- application (external_id NULL) is unaffected.
--
-- LOCKING, STATED PLAINLY. This is a plain CREATE UNIQUE INDEX, not CONCURRENTLY: the
-- runner applies each file and its ledger row in ONE transaction (`sql.transaction([...])`
-- in api/scripts/migrate.mjs), and CONCURRENTLY cannot run inside a transaction block. A
-- plain CREATE INDEX takes a SHARE lock on job_applications for the whole build — reads
-- continue, but every INSERT/UPDATE/DELETE on the table waits. The partial predicate means
-- the index ENTRIES are none (external_id is NULL everywhere until the importer runs), but
-- the build still scans the whole heap to evaluate it, so the pause scales with the size
-- of job_applications, not with the number of imported rows. It is a sequential scan of
-- one table, which is short at the sizes this table has; on a tenant base where it is not,
-- build the index CONCURRENTLY by hand before this migration runs (IF NOT EXISTS makes the
-- statement below a no-op then).

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_board_external
  ON job_applications (tenant_id, job_posting_id, source, external_id)
  WHERE external_id IS NOT NULL;
