-- 1093 — Re-commit the agent workflow to every repo, so a dispatch can be correlated.
--
-- THE PROBLEM
-- `workflow_dispatch` answers 204 with no body and no run id, and the workflow-runs
-- list does not echo a run's inputs. The only correlator we have is the execution id
-- stamped into the workflow's `run-name`, which GitHub returns as `display_title`.
-- Repos whose `.github/workflows/builderforce-agent.yml` was committed BEFORE
-- `run-name` existed produce anonymous runs, so `githubActionsReconcile` cannot tell
-- "GitHub never scheduled this" from "the run is right there, unnamed" — and it
-- correctly refuses to guess, returning `wait` and deferring to the 20-minute reaper.
-- Every one of those executions therefore gets the generic "silent run" message
-- instead of a reason naming a cause the operator can fix.
--
-- The only way out is for the repo to be running the CURRENT workflow file. Until now
-- the sole path to that was an operator noticing and clicking "Enable agent runs"
-- again, repo by repo — a fix that depends on somebody knowing to apply it.
--
-- WHAT THIS DOES
-- Gives every connected repo a record of WHICH revision of the workflow we last
-- committed to it, and a due-time queue the refresh sweep drains. Because no existing
-- row can name a revision, every existing repo is by definition "unknown revision",
-- and the migration queues them all. `runAgentWorkflowRefreshSweep` then walks that
-- queue at a bounded rate and re-commits the current workflow through the SAME
-- `ensureAgentWorkflow` path the enable button uses — one commit helper, not two.
--
-- WHY A REVISION AND NOT JUST A FLAG
-- A bare "needs refresh" boolean answers this migration and nothing after it. The
-- revision makes every FUTURE change to the committed surface a one-line migration
-- (`UPDATE … SET agent_workflow_refresh_due = now() WHERE agent_workflow_revision IS
-- DISTINCT FROM '<new>'`) instead of another bespoke backfill, and it lets the sweep
-- skip a repo that is already current without a GitHub call.
--
-- TERMINATION — the sweep must not re-commit forever:
--   • committed        → revision stamped, due = NULL, attempts = 0
--   • not enabled      → due = NULL (nothing to refresh; enabling stamps it later)
--   • transient failure→ attempts + 1, due = now() + backoff
--   • attempts ≥ 3     → due = NULL (give up; the operator path still works)
-- NULL `due` is the resting state, so a drained queue costs one indexed scan a tick.

ALTER TABLE project_repositories
  ADD COLUMN IF NOT EXISTS agent_workflow_revision VARCHAR(32),
  ADD COLUMN IF NOT EXISTS agent_workflow_refresh_due TIMESTAMP,
  ADD COLUMN IF NOT EXISTS agent_workflow_refresh_attempts SMALLINT NOT NULL DEFAULT 0;

-- Queue every GitHub repo. Non-GitHub providers have no Actions at all, so there is
-- nothing to commit and queueing them would only burn sweep budget rediscovering that.
UPDATE project_repositories
   SET agent_workflow_refresh_due = now(),
       agent_workflow_refresh_attempts = 0
 WHERE provider = 'github'
   AND agent_workflow_revision IS NULL;

-- The sweep's only query is "due and past", ordered oldest-first. Partial, because the
-- resting state of this column is NULL for every row and a full index would be almost
-- entirely dead weight.
CREATE INDEX IF NOT EXISTS project_repositories_agent_workflow_refresh_due_idx
  ON project_repositories (agent_workflow_refresh_due)
  WHERE agent_workflow_refresh_due IS NOT NULL;
