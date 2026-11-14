-- 1347 · PRD 39 §3 Push 1 — backfill skills.agent_registration_id and drop the
-- legacy `agents` foreign keys (columns are KEPT; the table/column drop is Push 2).
--
-- WHY. The legacy `agents` table was folded into `agent_registrations` by migration
-- 0394 through `legacy_agent_id`, which also backfilled executions.agent_registration_id
-- and agent_dispatches.agent_registration_id. `skills` had no registration link at the
-- time; it gains one now so `/api/skills` can join through `agent_registration_id`
-- instead of the dead table. The inbound FKs to `agents` are then dropped so the table
-- can be removed in Push 2 without cascading surprises; the columns stay as plain
-- integer compatibility references.

-- 1. Backfill `skills.agent_registration_id` from the folded legacy rows. The column
--    already exists (declared in schema); this only populates it, idempotently.
UPDATE skills s
SET agent_registration_id = r.id
FROM agent_registrations r
WHERE s.agent_id = r.legacy_agent_id
  AND s.agent_registration_id IS NULL;

-- One skill row resolves to at most one registration (legacy_agent_id is UNIQUE).
CREATE INDEX IF NOT EXISTS idx_skills_agent_registration
  ON skills(agent_registration_id);

COMMENT ON COLUMN skills.agent_id IS
  'DEPRECATED compatibility reference; use agent_registration_id.';

-- 2. The legacy-id lookup the runtime and routes use. `resolveAgentRegistration`
--    matches the uuid id only, so numeric refs resolve through `legacy_agent_id`.
--    STRICT (no implicit casting) keeps the planner on the integer unique index.
CREATE OR REPLACE FUNCTION resolve_agent_registration_by_legacy(p_legacy_id INTEGER, p_tenant_id INTEGER)
RETURNS UUID
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT id FROM agent_registrations
  WHERE legacy_agent_id = p_legacy_id AND tenant_id = p_tenant_id
  LIMIT 1;
$$;

-- 3. Drop the inbound FKs to the legacy `agents` table. Columns are kept; only the
--    constraints go. `DROP CONSTRAINT IF EXISTS` is idempotent. (The live constraint
--    names were confirmed from the Drizzle declarations and migration 0394 by code
--    inspection; no production query was run per the workspace rules.)
ALTER TABLE executions          DROP CONSTRAINT IF EXISTS executions_agent_id_agents_id_fk;
ALTER TABLE skills              DROP CONSTRAINT IF EXISTS skills_agent_id_agents_id_fk;
ALTER TABLE agent_dispatches    DROP CONSTRAINT IF EXISTS agent_dispatches_agent_id_agents_id_fk;
ALTER TABLE agent_registrations DROP CONSTRAINT IF EXISTS agent_registrations_legacy_agent_id_agents_id_fk;

COMMENT ON COLUMN executions.agent_id IS
  'DEPRECATED compatibility reference (no FK); use agent_registration_id.';
COMMENT ON COLUMN agent_dispatches.agent_id IS
  'DEPRECATED compatibility reference (no FK); use agent_registration_id.';
