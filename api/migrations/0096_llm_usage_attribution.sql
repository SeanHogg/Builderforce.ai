-- 0096_llm_usage_attribution.sql
-- Make the canonical usage/billing ledger attributable by agent, so cost can be
-- split CLOUD vs ON-PREM vs WEB.
--
-- Until now llm_usage_log had no agent dimension at all: on-prem agent-host
-- gateway calls, cloud-agent runs, and web/SDK calls all landed in one
-- undifferentiated pile (the dashboard even commented "approximation; real
-- per-agentHost requires agentHostId on log"). Cloud runs, meanwhile, recorded
-- only to usage_snapshots — a disjoint table with no shared key — so the two
-- ledgers could never be reconciled.
--
-- This adds the same attribution columns usage_snapshots / tool_audit_events
-- already carry (0092):
--   • agent_host_id   — self-hosted (on-prem) host that made the call (FK, nullable).
--   • cloud_agent_ref — cloud agent run (ide_agents.id, or null for the default bucket).
--   • execution_id    — the execution a cloud row belongs to (trace key).
-- A row with all three null is a web/SDK call. The cloud-agent execution loop now
-- also writes here (not just usage_snapshots), so usage reconciles across surfaces.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS agent_host_id   INTEGER REFERENCES agent_hosts(id) ON DELETE SET NULL;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS cloud_agent_ref VARCHAR(64);
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS execution_id    INTEGER;

-- Cost/usage breakdown reads: "tokens by agent host over a window".
CREATE INDEX IF NOT EXISTS idx_llm_usage_agent_host
  ON llm_usage_log (tenant_id, agent_host_id, created_at DESC);
-- Cost/usage breakdown reads: "tokens by cloud agent over a window".
CREATE INDEX IF NOT EXISTS idx_llm_usage_cloud_agent
  ON llm_usage_log (tenant_id, cloud_agent_ref, created_at DESC);
-- Reconcile a cloud execution's billing rows to its trace.
CREATE INDEX IF NOT EXISTS idx_llm_usage_execution
  ON llm_usage_log (execution_id);
