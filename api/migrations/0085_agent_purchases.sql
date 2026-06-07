-- 0085: per-tenant agent purchases (marketplace acquisitions).
--
-- Hiring an agent from the marketplace was previously only an aggregate counter
-- (ide_agents.hire_count) with no record of WHO acquired WHAT. This table tracks
-- each tenant's acquired agents so the /workforce directory can show purchased
-- (marketplace) agents alongside owned ones, and so an owned agent with any
-- purchase cannot be deleted out from under its buyers.
--
-- agent_id references ide_agents.id, which is a raw-SQL table (not in Drizzle),
-- so it is a plain varchar with no FK constraint.
CREATE TABLE IF NOT EXISTS agent_purchases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id   varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- One purchase row per (tenant, agent) — hiring is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_purchases ON agent_purchases (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_purchases_agent ON agent_purchases (agent_id);
