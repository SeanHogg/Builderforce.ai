-- Migration: one agent contributor per (tenant, agent host).
--
-- POST /api/analytics/sync-agents previously did select-then-insert per agent
-- host, so two concurrent syncs could create duplicate agent contributors for
-- one host. This partial unique index lets the route upsert (onConflictDoUpdate)
-- and makes the import idempotent under concurrency [1557]. Partial (kind='agent')
-- so it constrains only agent rows — human contributors aren't agent-host-keyed.
--
-- IF NOT EXISTS keeps it idempotent over the push baseline. Note: if duplicate
-- agent rows already exist they must be de-duped before this index can build;
-- on a clean/low-volume dataset that won't occur.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contributors_tenant_agent_host
  ON contributors (tenant_id, agent_host_id)
  WHERE kind = 'agent';
