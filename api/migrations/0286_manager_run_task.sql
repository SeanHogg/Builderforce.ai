-- 0286_manager_run_task.sql
-- Represent a manual AI Manager run as a first-class, owned, status-tracked board
-- task (visibility: what the manager did, by whom, and when).
--
-- Clicking "Run manager now" mints a `source = 'manager'` task assigned to the
-- designated manager, opened in-progress and finalized to done with the run summary
-- (see createManagerRunTask / finalizeManagerRunTask). Each decision that pass makes
-- links back to it via manager_actions.run_task_id, so the run task can show exactly
-- what it changed. Cron-sweep decisions leave run_task_id NULL (feed-only, no card —
-- a task per project per tick would flood the board).
--
-- The task carries no schema change of its own: it reuses the existing `tasks.source`
-- marker, which the SINGLE auto-run evaluator (evaluateTaskAutoRun) now short-circuits
-- so no coding agent ever tries to "execute" the coordination chore.

ALTER TABLE manager_actions
  -- The manager run task this decision belongs to (NULL = cron-sweep / feed-only).
  ADD COLUMN IF NOT EXISTS run_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

-- Group a run's decisions by the run task ("what did this pass change").
CREATE INDEX IF NOT EXISTS idx_manager_actions_run_task
  ON manager_actions(run_task_id);
