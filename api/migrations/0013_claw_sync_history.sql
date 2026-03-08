-- Sync history: records each .coderClaw directory sync event
CREATE TABLE claw_sync_history (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id      INTEGER NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  directory_id INTEGER REFERENCES claw_directories(id) ON DELETE SET NULL,
  triggered_by VARCHAR(32) NOT NULL DEFAULT 'startup',
  file_count   INTEGER NOT NULL DEFAULT 0,
  bytes_total  INTEGER NOT NULL DEFAULT 0,
  status       VARCHAR(16) NOT NULL DEFAULT 'success',
  error_msg    TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX claw_sync_history_claw_id_idx ON claw_sync_history(claw_id);
CREATE INDEX claw_sync_history_tenant_id_idx ON claw_sync_history(tenant_id);
