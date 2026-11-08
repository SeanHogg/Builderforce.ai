-- The dedupe key for board-imported applications (column added in 1323).
--
-- Partial: only rows that HAVE a board id participate, so every platform-made
-- application (external_id NULL) is unaffected. A plain CREATE INDEX, not CONCURRENTLY:
-- the migration runner applies each file inside one transaction (api/scripts/migrate.mjs),
-- where CONCURRENTLY is not allowed. It takes a brief write lock on job_applications; the
-- column was added a migration ago and is NULL everywhere, so the partial index has no
-- rows to build and the lock is momentary.

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_board_external
  ON job_applications (tenant_id, job_posting_id, source, external_id)
  WHERE external_id IS NOT NULL;
