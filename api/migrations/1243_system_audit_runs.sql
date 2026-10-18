-- Shared local/cloud audit lifecycle and durable remediation identities.
CREATE TABLE IF NOT EXISTS system_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  audit_id VARCHAR(64) NOT NULL,
  executor VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  baseline JSONB NOT NULL,
  findings JSONB,
  ticket_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_id UUID REFERENCES tool_runs(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  execution_id INTEGER REFERENCES executions(id) ON DELETE SET NULL,
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_audit_runs_project ON system_audit_runs(tenant_id, project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_audit_runs_retry ON system_audit_runs(status, updated_at);
CREATE TABLE IF NOT EXISTS system_audit_remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint VARCHAR(64) NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  lease_until TIMESTAMP,
  UNIQUE(tenant_id, project_id, fingerprint)
);
