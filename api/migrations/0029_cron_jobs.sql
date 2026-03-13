-- Cron jobs table: tracks scheduled jobs per claw, optionally associated with a project.
-- Uses a UUID (guid) as the canonical reference ID for cloud↔claw sync.
CREATE TABLE IF NOT EXISTS cron_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id       INTEGER NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  schedule      VARCHAR(255) NOT NULL,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMP,
  next_run_at   TIMESTAMP,
  last_status   VARCHAR(50),
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_tenant ON cron_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_claw   ON cron_jobs(claw_id);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_project ON cron_jobs(project_id);
