-- 0415 · Connected file storage (Google Drive / OneDrive)
--
-- An OAuth grant on a real drive, so a person can browse their own files inside
-- Builderforce and drop one onto the Creation Canvas without downloading it and
-- dragging it back in.
--
-- Deliberately its own table rather than a row in `integration_credentials`:
-- that vault is TENANT-scoped and pasted-secret shaped, while a Drive grant
-- belongs to a PERSON and is refreshed on a schedule. Shape follows
-- `mailbox_connections` (0414) — sealed token blob, expiry mirrored outside it,
-- natural key on (tenant, user, provider, account).

CREATE TABLE IF NOT EXISTS drive_connections (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        VARCHAR(64)  NOT NULL,
  provider       VARCHAR(24)  NOT NULL,
  account_email  VARCHAR(320) NOT NULL,
  display_name   VARCHAR(255) NOT NULL DEFAULT '',
  token_enc      TEXT         NOT NULL,
  token_iv       VARCHAR(64)  NOT NULL,
  expires_at     TIMESTAMP,
  scope          TEXT         NOT NULL DEFAULT '',
  status         VARCHAR(16)  NOT NULL DEFAULT 'connected',
  last_error     TEXT,
  cache_version  INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Re-consenting refreshes the grant in place rather than accumulating a row per
-- consent; including the account is what lets one user connect a personal and a
-- work drive of the same provider side by side.
CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_connections_account
  ON drive_connections (tenant_id, user_id, provider, account_email);

CREATE INDEX IF NOT EXISTS idx_drive_connections_tenant
  ON drive_connections (tenant_id, status);
