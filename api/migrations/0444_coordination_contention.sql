CREATE TABLE IF NOT EXISTS coordination_contention_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_key VARCHAR(255) NOT NULL, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  resource_key VARCHAR(512) NOT NULL, claimant_execution_id INTEGER,
  holder_execution_id INTEGER, claimant_label VARCHAR(255) NOT NULL,
  holder_label VARCHAR(255) NOT NULL, occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coordination_contention_scope ON coordination_contention_events(tenant_id, scope_key, occurred_at DESC);
