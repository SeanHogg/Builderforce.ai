-- Agent-host messaging channels — the registry behind GET /api/agent-hosts/:id/channels.
--
-- The endpoint answered `{ channels: [] }` from a hardcoded literal while a full
-- CRUD surface shipped against it, so create/update/delete 404'd and the list was
-- always empty. This is the table it was always supposed to read.
--
-- WHY THIS IS NOT A `connector_connections` ROW
-- A connection is an ACCOUNT ("our production Slack"). A channel is a routing
-- TARGET inside one ("#general"), bound to the host that actually runs the
-- adapter. One account carries many targets, so folding them together would put a
-- repeating group in a row that is read on every listing. `connection_id` points
-- at the account when one exists, which is what keeps the credential in one place
-- rather than pasted per channel.
--
-- SECRETS ARE SEALED, NEVER A PLAINTEXT `config` COLUMN. The surface accepts a bot
-- token or a webhook URL; those go through the same per-tenant AES-GCM credential
-- crypto every other integration uses, and are never read back out to a client.
CREATE TABLE IF NOT EXISTS agent_host_channels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  agent_host_id  INTEGER NOT NULL REFERENCES agent_hosts(id) ON DELETE CASCADE,
  -- A KIND COLUMN, not a table per platform: 'slack' | 'telegram' | 'webhook' | …
  platform       VARCHAR(32) NOT NULL,
  -- The target on that platform — '#general', a chat id, a webhook name.
  name           VARCHAR(255) NOT NULL,
  -- The credentialed account this target belongs to, when the tenant has connected
  -- one. NULL means the channel carries its own sealed config below.
  connection_id  UUID REFERENCES connector_connections(id) ON DELETE SET NULL,
  -- Sealed with the shared per-tenant credential crypto. Never a bare secret, and
  -- never returned to a client.
  config_enc     TEXT,
  config_iv      VARCHAR(64),
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set by the host when it reports the adapter's state; NULL until it does.
  last_status    VARCHAR(32),
  last_error     TEXT,
  last_seen_at   TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One target per platform per host: re-adding '#general' to the same Slack on the
-- same host is the same channel, and the database is what says so.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_host_channels_target
  ON agent_host_channels (agent_host_id, platform, name);

CREATE INDEX IF NOT EXISTS idx_agent_host_channels_tenant
  ON agent_host_channels (tenant_id, agent_host_id, enabled);
