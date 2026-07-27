-- Shared caught-error reporting context (operational database).
--
-- api_error_log lives in THIS database: persistCaughtError writes it through
-- buildTransactionalDatabase. Migration 0375 added the caught-error context
-- columns to the primary track only, so every handled-exception insert failed
-- with `column "source" does not exist` wherever
-- NEON_TRANSACTIONAL_DATABASE_URL is bound. This is the same DDL applied to the
-- database that actually receives the writes.

ALTER TABLE api_error_log
  ADD COLUMN IF NOT EXISTS tenant_id integer,
  ADD COLUMN IF NOT EXISTS source varchar(500),
  ADD COLUMN IF NOT EXISTS operation varchar(255),
  ADD COLUMN IF NOT EXISTS handled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_api_error_log_tenant_created
  ON api_error_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_error_log_source_operation
  ON api_error_log(source, operation, created_at DESC);

-- Retention sweeps and the superadmin log page both page by recency alone.
CREATE INDEX IF NOT EXISTS idx_api_error_log_created
  ON api_error_log(created_at DESC);
