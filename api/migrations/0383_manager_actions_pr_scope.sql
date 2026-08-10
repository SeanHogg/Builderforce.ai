-- 0383 — Scope the manager's PR ceilings to the PULL REQUEST, not to its ticket.
--
-- WHY: 0381 gave the PR loop two ceilings (sync, merge refusal) and a
-- least-recently-worked rotation, and keyed all three on `manager_actions.task_id`. That
-- key is wrong in two ways, and the first one is a live, measured, unbounded loop.
--
--   1. AN ORPHAN PR ESCAPES EVERY CEILING AND HOLDS THE HEAD OF THE QUEUE FOREVER.
--      `pull_requests.task_id` is nullable (it is `ON DELETE SET NULL`, and provider
--      ingest records PRs that were never opened from a ticket). The ceiling reads join
--      `pr_activity.task_id = pull_requests.task_id`, and in SQL `NULL = NULL` is never
--      true — so an orphan PR's own journalled actions can never be counted back to it.
--      Every guard in the loop is additionally written `pr.taskId != null && …`, so it is
--      skipped outright. Measured on project 11, 2026-07-29: "Could not merge PR #29 …
--      Pull Request is not mergeable" journalled with `{"attempt":1,"maxAttempts":3}`
--      SIX times in thirty minutes — attempt 1 every single time, because the count it
--      reads is structurally always zero. Worse, `last_acted_at` is NULL for the same
--      reason and the rotation sorts NULLS FIRST, so that one PR re-took a slot of the
--      20-PR window on every pass while 381 open PRs waited behind it.
--
--   2. TWO PRs ON ONE TICKET SHARE ONE COUNTER. A ticket that opens a replacement PR
--      inherits the retired one's failures and is refused before its first attempt.
--
-- The contract the counters belong to is the PULL REQUEST — that is the thing the loop
-- syncs, merges and retires — so this adds the column the counter should always have been
-- keyed on, plus the index the grouped per-pass scan needs on the new key.
--
-- DELIBERATELY NOT BACKFILLED. A ticket-keyed count is a count of a DIFFERENT contract,
-- and a fix that leaves the old tombstone in place is a fix that cannot be observed to
-- work: PR #29 would stay retired on a number that was never about PR #29. Starting the
-- PR-keyed counter at zero re-arms the ceiling on the correct contract, and the ceiling is
-- 3 — so a genuinely unmergeable PR retires within about fifteen minutes of this shipping
-- instead of looping indefinitely.

ALTER TABLE manager_actions
  ADD COLUMN IF NOT EXISTS pr_id uuid REFERENCES pull_requests(id) ON DELETE SET NULL;

COMMENT ON COLUMN manager_actions.pr_id IS
  'The pull request this action was about (0383). The PR loop''s sync / merge-refusal / conflict ceilings and its least-recently-worked rotation are counted on THIS key, never on task_id: pull_requests.task_id is nullable, and a NULL key silently exempted an orphan PR from every ceiling while pinning it to the front of the rotation on every pass.';

CREATE INDEX IF NOT EXISTS idx_manager_actions_pr_scope
  ON manager_actions(tenant_id, project_id, action_type, pr_id);

COMMENT ON INDEX idx_manager_actions_pr_scope IS
  'Serves the AI Manager PR loop: per-PULL-REQUEST counts of sync_pr / merge_failed / pr_conflict / merge_blocked and the newest PR action per PR (least-recently-worked rotation). Replaces the task_id-keyed idx_manager_actions_pr_ceiling from 0381 for that read — see 0383 for why the ticket was the wrong key.';
