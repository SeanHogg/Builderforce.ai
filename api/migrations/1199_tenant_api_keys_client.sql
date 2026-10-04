-- 1199 · `tenant_api_keys.client` — which app a device-flow key belongs to.
--
-- `POST /api/auth/tenant-api-key-token` minted every session with
-- `clientSurface: 'vscode'`, because a key row did not record which app it was minted
-- for — only its display name. Synapse's sessions were attributed to VS Code, and
-- Spawn would have been too. The device flow already knows the client
-- (`DEVICE_CLIENTS`); this keeps it on the key so the exchange can stamp it.
--
-- NULL = a key made by hand in Settings or minted before this migration; those keep
-- the editor attribution they always had.

ALTER TABLE tenant_api_keys
  ADD COLUMN IF NOT EXISTS client varchar(32);

-- Keys the device flow minted before this column existed are named after their app.
UPDATE tenant_api_keys SET client = 'synapse' WHERE client IS NULL AND name = 'Synapse';
UPDATE tenant_api_keys SET client = 'vscode'  WHERE client IS NULL AND name = 'VS Code';
