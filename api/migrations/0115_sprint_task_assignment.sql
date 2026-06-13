-- 0115_sprint_task_assignment.sql
-- Wire a task to a sprint for the Planning ceremony: a task can belong to at most
-- one sprint. This mirrors the existing single-ownership task model (a task has one
-- project, one parent, one assignee — now one optional sprint), so a direct FK on
-- tasks is the right shape rather than a junction (switch to a junction only if
-- multi-sprint grooming emerges later).
--
-- ON DELETE SET NULL: deleting a sprint un-schedules its tasks rather than
-- cascading them away (the work survives the sprint). sprints.id is a UUID
-- (see 0060_agile_survival.sql), so sprint_id is UUID to match.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL;

-- Partial index: only scheduled tasks carry a sprint, so the index stays small and
-- backs the "list tasks in this sprint" read.
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL;
