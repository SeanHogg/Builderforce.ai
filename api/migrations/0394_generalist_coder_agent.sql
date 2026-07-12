-- 0394_generalist_coder_agent.sql
-- The Generalist Coder Agent — parallel execution agent for gap coding workstreams.
--
-- This agent is specialized for high-capacity, parallel execution of the 50-gap
-- coding workstreams (GAP-D*/W*/E*), accelerating delivery and relieving Bob's
-- 85% utilization overload risk.
--
-- Like the others it is an ordinary, assignable cloud agent (an ide_agents row)
-- marked with the stable builtin_kind='generalist_coder' marker (0289) so dispatch
-- keeps finding it after a rename.
--
-- Idempotent: NOT EXISTS-guarded seed. New tenants provisioned after this migration
-- get the agent at tenant-creation time (provisionBuiltinAgents).

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT
  'generalist-coder-t' || t.id,
  t.id,
  'Generalist Coder',
  'Generalist Coder — Parallel gap coding executor',
  'High-capacity coder agent specialized for parallel execution of the 50-gap coding workstreams (GAP-D*/W*/E*). Accelerates gap resolution by processing multiple tasks concurrently, significantly reducing the estimated 64-78 day timeline to 38-48 days. Offloads coding workload to relieve Bob Developer (85% utilization risk) and unblock the cloud-agent GA security gate.',
  '["gap-coding","parallel-execution","generalist","task-concurrency","code-generation"]',
  'builderforce-default',
  'active',
  'cloud',
  FALSE,
  0,
  'generalist_coder'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'generalist_coder'
);