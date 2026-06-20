-- 0201_device_authorizations.sql
-- Browser device-code (RFC 8628) sign-in for editor clients (VS Code extension).
--
-- The gateway is API-key-only; this table bridges that to a one-click browser login.
-- The CLI/extension POSTs /api/auth/device/code to get a (device_code, user_code) pair,
-- opens the browser to /activate, the signed-in user approves (which mints a tenant
-- gateway key, bfk_*, stored encrypted for one-time delivery), and the extension polls
-- /api/auth/device/token until it receives the key. Short-lived; rows are swept.
--
--   device_code_hash — hash of the extension-held secret (plaintext never stored).
--   user_code        — short human-readable code shown/clicked in the browser.
--   issued_key_enc   — minted tenant key, encrypted at rest, nulled on first claim.
CREATE TABLE IF NOT EXISTS device_authorizations (
  id               serial PRIMARY KEY,
  device_code_hash varchar(128) NOT NULL,
  user_code        varchar(16)  NOT NULL,
  user_id          varchar(36)  REFERENCES users(id)   ON DELETE SET NULL,
  tenant_id        integer      REFERENCES tenants(id) ON DELETE SET NULL,
  status           varchar(16)  NOT NULL DEFAULT 'pending',
  issued_key_enc   text,
  scopes           varchar(256) NOT NULL DEFAULT 'gateway',
  client           varchar(32),
  interval_secs    integer      NOT NULL DEFAULT 5,
  expires_at       timestamp    NOT NULL,
  approved_at      timestamp,
  last_polled_at   timestamp,
  created_at       timestamp    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_auth_device_code ON device_authorizations(device_code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_auth_user_code   ON device_authorizations(user_code);
CREATE INDEX IF NOT EXISTS idx_device_auth_expires ON device_authorizations(expires_at);
