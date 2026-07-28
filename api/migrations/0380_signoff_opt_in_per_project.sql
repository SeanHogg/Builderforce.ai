-- 0380 — Role sign-off becomes an OPT-IN project setting, and is switched OFF everywhere.
--
-- WHY: 0362 added `require_signoff_to_complete` as a default-ON safety gate — the AI
-- Manager could only complete a ticket and merge its PR once every REQUIRED participation
-- slot had recorded a verdict. The premise was right (other team members sign off, so the
-- work is actually reviewed); the DEFAULT was wrong. Measured on the reference project
-- (id 11) 26 days after 0362 landed:
--
--   • 265 of 679 stalled tickets were stalled on `awaiting_signoff`, the oldest idle for
--     48 days, against 0 tickets finished that day and 0 the day before;
--   • 22 of the 200 deep-triaged tickets carried the `drive_signoff` remedy, and the
--     manager re-issued the same ask every 5-minute pass — 1,214 `flag` decisions in one
--     day — because a gate whose slots nobody satisfies never opens;
--   • 4 required slots were owed by an agent that had finished every run it was given
--     WITHOUT recording a verdict, so those tickets could never clear at all.
--
-- A review gate nobody chose is indistinguishable from a deadlock. So the gate stays — it
-- is a genuine quality practice and the toggle is unchanged — but it is now something a
-- PROJECT turns on deliberately, on the Manager policy panel, and the manager consults
-- that project setting before it holds a ticket for a verdict.
--
-- THREE WRITES, and all three are needed for "off for every project" to be true:
--   1. the column default, so a project configured tomorrow does not re-acquire the gate;
--   2. every existing project row, which 0362's `DEFAULT true` backfilled to true;
--   3. every workspace row — `require_signoff_to_complete` folds as an OBLIGATION
--      (most-restrictive-wins, see managerPolicy.ts), so an explicit workspace `true` is a
--      FLOOR that would silently re-impose the gate on projects that just opted out. NULL
--      is the neutral state: "the workspace has no opinion; each project decides." That
--      is exactly the tier semantics the setting needs to be a project setting at all.
--
-- Turning it back on is one toggle per project (or one at the workspace tier to mandate it
-- for all of them). See application/kanban/signoffGate.ts `resolveRequiredSignoffGate` —
-- the single policy-aware read that the conduct step, the merge and stall triage all use.

-- 1. New projects: no gate unless asked for.
ALTER TABLE project_manager_configs
  ALTER COLUMN require_signoff_to_complete SET DEFAULT false;

-- 2. Every existing project: off.
UPDATE project_manager_configs
   SET require_signoff_to_complete = false,
       updated_at = now()
 WHERE require_signoff_to_complete IS DISTINCT FROM false;

-- 3. Every workspace: no opinion, so the project tier is the one that decides.
UPDATE tenant_manager_defaults
   SET require_signoff_to_complete = NULL,
       updated_at = now()
 WHERE require_signoff_to_complete IS NOT NULL;

COMMENT ON COLUMN project_manager_configs.require_signoff_to_complete IS
  'OPT-IN (default false since 0380). When true, the AI Manager may only complete a ticket, merge its PR, or stop chasing a stage''s owed roles once every REQUIRED ticket_participants slot has a satisfied verdict (completed/waived/skipped); a ticket with no required slots never qualifies. When false nothing in the platform holds a ticket for a verdict. Folded as an obligation: an explicit true at the workspace tier is a floor this column cannot relax.';

COMMENT ON COLUMN tenant_manager_defaults.require_signoff_to_complete IS
  'Workspace sign-off FLOOR. NULL (the norm) = no workspace opinion, so each project''s own require_signoff_to_complete decides. TRUE mandates unanimous role sign-off across every project in the workspace and cannot be relaxed by a project row. FALSE is equivalent to NULL for this field, since the fold takes the strictest opinion.';
