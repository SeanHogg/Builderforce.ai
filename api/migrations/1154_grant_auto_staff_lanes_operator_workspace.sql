-- 1154 — GRANT `allowAutoStaffLanes` ON THE OPERATOR'S WORKSPACE (tenant 1).
--
-- Operator decision, 2026-09-12: "Grant allowAutoStaffLanes." The switch (0386) lets the
-- manager pin a capable roster agent to a lane that authorises NO role — measured on
-- project 11 as `backlog` (299 tickets) and `blocked` (10), 46% of the stalled board,
-- reported every pass as `lane_unconfigured` and deliberately left alone while the grant
-- was withheld. The 429 capacity/routing fix landed 2026-08-19, so granting it no longer
-- starts that cohort into a pool that would reject it.
--
-- SCOPE: tenant 1 only — the workspace every roadmap measurement names ("tenant 1",
-- "all 10 boards", project 11). The default for every other tenant is untouched: the
-- built-in value stays `false` and no other tenant_manager_defaults row is written.
--
-- GUARDED so a database where tenant 1 is not that workspace (a fresh dev/CI database
-- whose first tenant is a seed) is left alone: it applies only when project 11 belongs to
-- tenant 1, which is the identifying fact of the operator's workspace.
--
-- HOW: the WORKSPACE tier (tenant_manager_defaults) is set to `true`, which every board
-- in the workspace inherits. The grant folds most-restrictive-wins, so an explicit
-- project `false` would still be a ceiling on that one board; the operator's decision
-- covers all of the workspace's boards, so any such project opinion is cleared back to
-- NULL (= inherit the grant). Admins can revoke either tier afterwards from Settings →
-- AI Manager or the project's Manager policy panel.
--
-- IDEMPOTENT: re-running writes nothing once the grant is in place.

INSERT INTO tenant_manager_defaults (tenant_id, allow_auto_staff_lanes, updated_at)
SELECT 1, true, now()
WHERE EXISTS (SELECT 1 FROM projects WHERE id = 11 AND tenant_id = 1)
ON CONFLICT (tenant_id) DO UPDATE
  SET allow_auto_staff_lanes = true, updated_at = now()
  WHERE tenant_manager_defaults.allow_auto_staff_lanes IS DISTINCT FROM true;

UPDATE project_manager_configs
   SET allow_auto_staff_lanes = NULL, updated_at = now()
 WHERE tenant_id = 1
   AND allow_auto_staff_lanes = false
   AND EXISTS (SELECT 1 FROM projects WHERE id = 11 AND tenant_id = 1);
