-- 1274 · Contract for 1261 — drop `skill_assignments`.
--
-- Ship ONLY after the Worker that reads `artifact_assignments` for skill grants (the
-- 1261 code) is live AND the Worker that registers it `restricted` (no generic query)
-- is live. Re-runs the 1261 copy, `backfill_skill_assignments()` (the one copy), for
-- whatever the old Worker granted during the deploy window, then drops the folded table
-- and the backfill function.
--
-- Guard: before the drop, every `skill_assignments` row must be carried by an
-- `artifact_assignments` row (same tenant, skill, scope and scope target). If any is
-- not, the migration aborts rather than dropping a grant.
--
-- Idempotent: the copy and the drop run only while the table exists; the function drop
-- is IF EXISTS.

DO $$
DECLARE
  uncarried INTEGER;
BEGIN
  IF to_regclass('skill_assignments') IS NULL THEN
    RAISE NOTICE '1274: skill_assignments already dropped — nothing to fold';
    RETURN;
  END IF;

  PERFORM backfill_skill_assignments();

  SELECT count(*) INTO uncarried
    FROM skill_assignments sa
   WHERE NOT EXISTS (
     SELECT 1 FROM artifact_assignments aa
      WHERE aa.tenant_id = sa.tenant_id
        AND aa.artifact_type = 'skill'
        AND aa.artifact_slug = sa.skill_slug
        AND aa.scope = CASE WHEN sa.agent_host_id IS NULL THEN 'tenant' ELSE 'host' END::assignment_scope
        AND aa.scope_id = COALESCE(sa.agent_host_id, sa.tenant_id)
   );
  IF uncarried > 0 THEN
    RAISE EXCEPTION '% skill_assignments row(s) are not carried by artifact_assignments; not dropping the table.', uncarried;
  END IF;

  DROP TABLE skill_assignments;
END $$;

DROP FUNCTION IF EXISTS backfill_skill_assignments();
