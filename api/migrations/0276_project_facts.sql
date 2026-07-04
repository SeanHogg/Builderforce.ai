-- 0276_project_facts.sql
-- Shared, per-project write-through FACTS store — the project-scoped twin of the
-- tenant `agent_memory`. Every surface (VS Code, web Brain, cloud agent, on-prem)
-- reads AND writes the SAME project facts here instead of a local-disk or
-- tenant-only store, so a fact one run learns is recalled by every other run on
-- that project. Write-through per the Evermind law (update == replace, no
-- accumulation): upsert on (tenant_id, project_id, key).
--
-- Idempotent / re-runnable: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS project_facts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         varchar(255) NOT NULL,
  content     text NOT NULL,
  source      varchar(64) NOT NULL DEFAULT 'agent',
  importance  real NOT NULL DEFAULT 0.5,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_facts UNIQUE (tenant_id, project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_project_facts_project ON project_facts (tenant_id, project_id);
