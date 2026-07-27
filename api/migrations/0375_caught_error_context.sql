-- Shared caught-error reporting context.
--
-- api_error_log previously held only unhandled HTTP 500s. Handled exceptions now
-- use the same durable stream, so retain their tenant/source/operation identity
-- as queryable columns instead of burying it in a formatted message.

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
