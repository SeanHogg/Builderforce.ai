-- 0385 — Record whether a finished run left ANYTHING behind, so autonomy can stop
-- re-dispatching a ticket whose runs accomplish nothing.
--
-- WHY: the autonomy circuit breaker (MAX_CONSECUTIVE_AUTORUN_FAILURES = 3) and its
-- exponential cooldown were both keyed on `status = 'failed'`. A run that COMPLETES and
-- ships nothing reset the streak to zero and owed no backoff, so it was re-dispatched on
-- the very next five-minute tick — forever. The only stopping condition the executor ever
-- had was FAILURE.
--
-- Measured on project 11, 2026-07-29 (api 2026.7.181, i.e. with the manager-side fixes
-- already live):
--
--   • 5,931 agent runs completed, 10 failed, in one day
--   • 3 tickets finished, 2 pull requests merged
--   • ONE agent (Bob Developer) accounted for 5,796 runs and 0 finished tickets
--   • 371 of 669 stalled tickets had NEVER run once, oldest idle 50 days
--
-- The breaker never armed, because nothing ever failed. And the two numbers are the same
-- fact: the tenant's 25-dispatches-per-tick ceiling was ~80% consumed all day re-running
-- tickets that had already run and produced nothing, so the never-started cohort could
-- never win a slot. Fixing the executor's candidate window (0384) freed a ticket's slot
-- only while its run was LIVE — the moment it ended, the same top-ranked ticket was
-- eligible again.
--
-- The verdict itself needed no new judgement: `finalizeLearnWeight` has graded every run
-- "merged > opened > wrote-files > no-op" since it replaced text-length as the Evermind
-- teaching weight. The platform always knew which runs accomplished nothing; it spent
-- that verdict on teaching the model and threw it away for the one decision that would
-- have stopped the burn. This column persists it (see `runProducedOutput`).
--
-- NULLABLE, AND NULL MEANS "PRODUCTIVE". Every row that already exists predates the
-- stamp, and every dispatch surface that does not route through `finalizeCloudRun` (host
-- runs, the V1 loop) will keep writing NULL. Treating unknown as unproductive would trip
-- the breaker on the entire board the moment this deploys and halt autonomy everywhere —
-- so the streak BREAKS on a NULL, exactly as it breaks on a `completed` today. The
-- behaviour change is therefore confined to runs this platform can actually judge, and a
-- genuinely stuck ticket still reaches the ceiling within three ticks.

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS produced boolean;

COMMENT ON COLUMN executions.produced IS
  'Did this finished run leave anything behind — a commit, a PR, a merge, or a lane move (0385)? Read by the autonomy circuit breaker + cooldown, which previously counted only FAILED runs and so never armed on a board where every run completed and shipped nothing. NULL = not judged (legacy rows and non-cloud surfaces) and is treated as PRODUCTIVE, so an unknown never halts autonomy.';

-- The breaker reads the newest runs for one task and walks them until the streak breaks;
-- 0384's (task_id, status) index serves the live-run probe but not this ordered read.
CREATE INDEX IF NOT EXISTS idx_executions_task_recent
  ON executions(task_id, created_at DESC);

COMMENT ON INDEX idx_executions_task_recent IS
  'Serves the per-ticket newest-first execution walk behind the autonomy breaker + cooldown (ExecutionRepository.findByTask). Added 0385, when a completed-but-unproductive run started counting toward the streak and the walk moved onto the dispatch hot path.';
