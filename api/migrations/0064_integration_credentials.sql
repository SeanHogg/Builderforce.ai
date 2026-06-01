-- Migration: Integration credentials baseline.
--
-- Root-cause fix for the deploy failure
--   NeonDbError: type "integration_provider" does not exist  (42704)
-- raised by 0065_external_board_sync.sql's `ALTER TYPE integration_provider …`.
--
-- The `integration_provider` enum and `integration_credentials` table were
-- declared in schema.ts and created in dev via `drizzle-kit push`, but never
-- captured as a tracked migration (they live in .schema-drift-allowlist.txt as
-- grandfathered drift). Production never had them, so every migration that
-- references them (0065 ALTER TYPE, 0065/0067 credential_id FK) aborts the run.
--
-- This migration creates them idempotently so it is a no-op on dev (where push
-- already made them) and the missing-schema fix on prod. It sorts after
-- 0064_cloud_agent_boards.sql and before 0065_external_board_sync.sql, so the
-- enum exists by the time 0065 adds 'rally'/'freshworks' to it.

-- Enum: integration providers. Values mirror schema.ts integrationProviderEnum
-- (incl. 'rally'/'freshworks' that 0065 re-adds via ADD VALUE IF NOT EXISTS — a
-- harmless no-op once they already exist here).
DO $$
BEGIN
  CREATE TYPE integration_provider AS ENUM (
    'github', 'bitbucket', 'jira', 'confluence', 'freshservice', 'rally', 'freshworks'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Enum: sync run status (schema.ts integrationSyncStatusEnum).
DO $$
BEGIN
  CREATE TYPE integration_sync_status AS ENUM ('idle', 'syncing', 'success', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Per-tenant integration credentials. credentials_enc holds the AES-256-GCM
-- ciphertext; iv is the per-credential nonce. (schema.ts integrationCredentials)
CREATE TABLE IF NOT EXISTS integration_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  provider        integration_provider NOT NULL,
  name            VARCHAR(255) NOT NULL,
  base_url        VARCHAR(500),
  credentials_enc TEXT NOT NULL,
  iv              VARCHAR(64) NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_tested_at  TIMESTAMP,
  last_test_ok    BOOLEAN,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_integration_tenant_provider_name UNIQUE (tenant_id, provider, name)
);

-- segment_id default-fill trigger + NOT NULL, matching the treatment 0056 gave
-- this table when it already existed (0056 guarded with to_regclass, so on a DB
-- where the table was missing it did nothing — this re-applies it idempotently).
DROP TRIGGER IF EXISTS trg_integration_credentials_segment ON integration_credentials;
CREATE TRIGGER trg_integration_credentials_segment BEFORE INSERT ON integration_credentials FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE integration_credentials x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE integration_credentials ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integration_credentials_segment ON integration_credentials(segment_id);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_tenant ON integration_credentials(tenant_id, provider);

-- Sync run log — one row per integration sync attempt. (schema.ts integrationSyncLogs)
CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  credential_id   UUID NOT NULL REFERENCES integration_credentials(id) ON DELETE CASCADE,
  status          integration_sync_status NOT NULL DEFAULT 'syncing',
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_errored   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  duration_ms     INTEGER,
  cursor_after    TEXT,
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMP
);
DROP TRIGGER IF EXISTS trg_integration_sync_logs_segment ON integration_sync_logs;
CREATE TRIGGER trg_integration_sync_logs_segment BEFORE INSERT ON integration_sync_logs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_credential ON integration_sync_logs(credential_id, started_at);
