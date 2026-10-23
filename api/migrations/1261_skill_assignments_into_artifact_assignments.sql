-- 1261 · `skill_assignments` -> `artifact_assignments` — ONE skill-assignment store.
--
-- WHY. Two tables held "which skills may this workspace / host use":
--   • `skill_assignments` (1108) — written by `/api/skill-assignments` and the agent-host
--     panel, read only by the host skills-list endpoint;
--   • `artifact_assignments` — what `resolveArtifacts` reads for run prompts, the skill
--     library catalog and the on-prem sync.
-- A host grant made in the panel therefore never reached a run. `artifact_assignments`
-- already carries both scopes (`scope` 'tenant' with scope_id = the tenant, 'host' with
-- scope_id = the agent host), so it wins and the other is folded in.
--
-- A UNION OF GRANTS. Every copy is INSERT ... WHERE NOT EXISTS (and the composite primary
-- key backs it with ON CONFLICT DO NOTHING): a grant held in both stores stays one row,
-- and nothing already in `artifact_assignments` is changed. There is nothing to conflict.
--
-- EXPAND / CONTRACT. The table is NOT dropped here: the Worker live while this runs
-- still writes it. The copy is ONE function, `backfill_skill_assignments()`, so the held
-- contract migration (1271) re-runs it for whatever the old Worker granted during the
-- deploy window, then drops the table and the function. A grant the old Worker REVOKED
-- in that window survives as a copy; the window is minutes and a revoke is one click, so
-- it is called out here rather than carried by a ledger table.
--
-- `assigned_by` is carried only when the user still exists: `skill_assignments` had no
-- FK on it, `artifact_assignments` does, and ON CONFLICT does not catch an FK violation.

CREATE OR REPLACE FUNCTION backfill_skill_assignments() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('public.skill_assignments') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO artifact_assignments (tenant_id, artifact_type, artifact_slug, scope, scope_id, assigned_by, assigned_at)
  SELECT sa.tenant_id, 'skill', sa.skill_slug, 'tenant', sa.tenant_id,
         CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = sa.assigned_by) THEN sa.assigned_by END, sa.assigned_at
  FROM skill_assignments sa
  WHERE sa.agent_host_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM artifact_assignments aa
      WHERE aa.tenant_id = sa.tenant_id
        AND aa.artifact_type = 'skill'
        AND aa.artifact_slug = sa.skill_slug
        AND aa.scope = 'tenant'
        AND aa.scope_id = sa.tenant_id
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO artifact_assignments (tenant_id, artifact_type, artifact_slug, scope, scope_id, assigned_by, assigned_at)
  SELECT sa.tenant_id, 'skill', sa.skill_slug, 'host', sa.agent_host_id,
         CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = sa.assigned_by) THEN sa.assigned_by END, sa.assigned_at
  FROM skill_assignments sa
  WHERE sa.agent_host_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM artifact_assignments aa
      WHERE aa.tenant_id = sa.tenant_id
        AND aa.artifact_type = 'skill'
        AND aa.artifact_slug = sa.skill_slug
        AND aa.scope = 'host'
        AND aa.scope_id = sa.agent_host_id
    )
  ON CONFLICT DO NOTHING;
END;
$$;

SELECT backfill_skill_assignments();
