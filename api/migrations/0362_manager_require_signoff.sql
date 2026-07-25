-- 0362 — Manager self-governance requires unanimous agent sign-off.
--
-- WHY: `coordinatePullRequests` already gave the AI Manager full completion authority —
-- it force-wrote `tasks.status = 'done'` for any in-review ticket with a branch and then
-- squash-merged the PR, with NO verification that the ticket's required participation
-- roles had actually signed off (and, under the default `pr_merge_policy = 'immediate'`,
-- no CI check either). Measured effect: only 0.7% of tickets reached Done through a
-- reviewed path, while qualifying tickets were merged unreviewed every 5 minutes.
--
-- This flag makes unanimous sign-off the PRECONDITION for autonomous completion/merge.
-- It defaults TRUE — the safe behaviour — so an existing project without an explicit
-- config row is tightened, not silently left auto-merging unreviewed work. Setting it
-- FALSE restores the previous (unverified) behaviour deliberately and visibly.
--
-- Pairs with `application/kanban/signoffGate.ts`, which fails CLOSED on an empty
-- manifest: "all required roles signed off" must not be vacuously true for a ticket
-- that nobody reviewed.

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS require_signoff_to_complete boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN project_manager_configs.require_signoff_to_complete IS
  'When true (default), the AI Manager may only complete a ticket and merge its PR once every REQUIRED ticket_participants slot has a satisfied verdict (completed/waived/skipped). A ticket with no required slots never qualifies. False restores pre-0362 behaviour: complete + merge with no sign-off verification.';
