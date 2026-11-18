-- 1352 · PRD 47 §3.3 — the archive `archived_at` expand (EXPAND, no drops).
--
-- WHY. PRD 47 gives every collection entity a uniform Active / Archived / All
-- filter mapped to `archived=exclude|only|all`. Entities that already represent
-- archive keep their column (`tasks.archived`, `projects.status`,
-- `creation_sessions.archived_at`, `brain_chats.is_archived`, `specs.status`) and
-- adapt it in their bulk port. These ten tables have no archive state at all, so
-- they gain a nullable `archived_at timestamptz` — NULL = active, a timestamp =
-- archived — plus the standard partial index that keeps the default
-- (`archived_at IS NULL`) list fast.
--
-- EXPAND only: nullable column, no rewrites, no drops. Safe under the
-- expand/contract rule as a single push.

SET LOCAL lock_timeout = '3s';

ALTER TABLE workflows              ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE workflow_definitions   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE teams                  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE chat_sessions          ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE marketplace_personas   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE prompt_library_entries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE alerts                 ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE knowledge_documents    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE prod_incidents         ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE rfp_requests           ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- The default-list index: (tenant) over the ACTIVE rows only. Every archived
-- read is rare, so the partial index serves the hot path and stays small.
CREATE INDEX IF NOT EXISTS idx_workflows_tenant_active
  ON workflows (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_active
  ON workflow_definitions (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_teams_tenant_active
  ON teams (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_active
  ON chat_sessions (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_personas_tenant_active
  ON marketplace_personas (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_library_entries_tenant_active
  ON prompt_library_entries (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_active
  ON alerts (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_active
  ON knowledge_documents (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prod_incidents_tenant_active
  ON prod_incidents (tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfp_requests_tenant_active
  ON rfp_requests (tenant_id) WHERE archived_at IS NULL;
