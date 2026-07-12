-- 0393_cloud_security_agent.sql
-- The Cloud Security Agent — specialized for GAP-G1/G2/G3 (P0 security/isolation gaps)
-- and cloud-Worker isolation validation, unblocking the GA security gate.
--
-- This agent is a first-class, assignable cloud agent with security-isolation
-- specialization distinct from the existing SOC 2 Auditor (0291).
--
-- Like the others it is an ordinary, assignable cloud agent (an ide_agents row)
-- marked with the stable builtin_kind='cloud_security' marker (0289) so dispatch
-- keeps finding it after a rename.
--
-- Idempotent: NOT EXISTS-guarded seed. New tenants provisioned after this migration
-- get the agent at tenant-creation time (provisionBuiltinAgents).

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT
  'cloud-security-t' || t.id,
  t.id,
  'Cloud Security',
  'Cloud Security — GAP-G1/G2/G3 P0 security/isolation + cloud-Worker validation',
  'Specialist for critical cloud security gaps (GAP-G1/G2/G3) and cloud-Worker isolation validation. Proactively identifies and resolves P0 security/isolation issues that block General Availability. Validates isolation boundaries for all cloud Worker workstreams, preventing cross-tenant and unauthorized access risks.',
  '["cloud-security","isolation-validation","ga-blockers","worker-isolation","security-isolation"]',
  'builderforce-default',
  'active',
  'cloud',
  FALSE,
  0,
  'cloud_security'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'cloud_security'
);