-- Migration: Repair tenants created without a default segment.
--
-- The 0054 backfill gave every tenant existing AT THAT TIME a default segment,
-- but tenant creation (TenantRepository.save) did not mint one for NEW tenants.
-- So every tenant created between 0054 and the save() fix is missing its default
-- segment, and every business request faults in resolveSegment():
--   500  {"error":"No default segment for tenant N"}
-- (observed for tenant 10 on /api/projects, /api/tasks, /api/agent-hosts,
--  /api/approvals after a fresh LinkedIn signup + workspace creation).
--
-- This re-runs the 0054 backfill idempotently. The partial unique index
-- uq_segments_one_default_per_tenant + the NOT EXISTS guard make it safe to
-- run repeatedly and a no-op for tenants already healed by the code fix.

INSERT INTO segments (tenant_id, display_name, slug, plan, status, is_default)
SELECT t.id, t.name, 'default', t.plan::text, 'active'::segment_status, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM segments s WHERE s.tenant_id = t.id AND s.is_default
);
