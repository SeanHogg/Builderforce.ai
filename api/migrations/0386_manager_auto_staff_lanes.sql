-- 0386 — MAY THE MANAGER STAFF A LANE NOBODY CONFIGURED?
--
-- Measured on project 11 (2026-07-31): `backlog` held 299 tickets and `blocked` 10, both
-- `lane_unstaffed` — no required role declared and no agent staffed. On a lifecycle-managed
-- board every run must be attributed to a role the stage authorises, so nothing can ever
-- leave those lanes. That is 46% of the board, and the manager reported it every pass while
-- being structurally unable to act: its staffing remedy is keyed on a role KEY, and a lane
-- that authorises nothing has no key to name.
--
-- The remedy is real (pin a capable roster agent to the lane), but turning it on is a
-- GOVERNANCE decision, not a mechanical one: it converts a several-hundred-ticket intake
-- pile into auto-dispatching work. So it is a grant, false by default, folded
-- most-restrictive-wins exactly like `allow_auto_merge` — an explicit workspace `false` is
-- a ceiling no project may re-grant itself.
--
-- Nullable at BOTH tiers on purpose: NULL means "this tier has no opinion", which is what
-- lets a project that has never been asked inherit rather than be pinned.

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS allow_auto_staff_lanes boolean;

ALTER TABLE tenant_manager_defaults
  ADD COLUMN IF NOT EXISTS allow_auto_staff_lanes boolean;

COMMENT ON COLUMN project_manager_configs.allow_auto_staff_lanes IS
  'May the manager staff a lane that authorises NO role at all (no requirement, no staffed agent)? NULL = inherit the workspace tier. Folded most-restrictive-wins; false by default because it turns an intake pile into auto-dispatching work.';

COMMENT ON COLUMN tenant_manager_defaults.allow_auto_staff_lanes IS
  'Workspace ceiling for project_manager_configs.allow_auto_staff_lanes. NULL = no workspace opinion.';
