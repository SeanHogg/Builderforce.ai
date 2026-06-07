-- 0089_task_file_changes.sql
-- Durable per-agent file-change traceability for a ticket's shared workspace.
-- Each row = one file the executing agent created/modified/deleted, attributed
-- to that agent ("Agent X created 2 files; Agent Y ran the tests"). Written by
-- the agent host on each run; read by the task's Changes tab.
CREATE TABLE IF NOT EXISTS task_file_changes (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id       INTEGER     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  execution_id  INTEGER,
  path          TEXT        NOT NULL,
  change        TEXT        NOT NULL,  -- created | modified | deleted
  agent         TEXT        NOT NULL,  -- executing agent label (attribution)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_file_changes_task ON task_file_changes (task_id, created_at DESC);
