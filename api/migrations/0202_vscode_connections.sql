-- 0202_vscode_connections.sql
-- Track the VS Code "coder agent" as a human-in-the-loop connection: a third agent
-- runtime alongside Cloud and On-Prem (agentHosts). When a human signs the extension in
-- (mints/uses a tenant key) and it heartbeats, we record that this user has a live VS
-- Code connection for the tenant, so the workforce/observability surfaces can show it.
CREATE TABLE IF NOT EXISTS vscode_connections (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  machine_name      varchar(255) NOT NULL DEFAULT 'vscode',
  extension_version varchar(32),
  status            varchar(16) NOT NULL DEFAULT 'active',
  connected_at      timestamp NOT NULL DEFAULT now(),
  last_seen_at      timestamp NOT NULL DEFAULT now(),
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vscode_conn_user_machine
  ON vscode_connections(tenant_id, user_id, machine_name);
CREATE INDEX IF NOT EXISTS idx_vscode_conn_tenant ON vscode_connections(tenant_id);
