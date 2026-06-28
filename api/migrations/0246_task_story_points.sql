-- 0246_task_story_points.sql
-- EMP-4: normalize STORY POINTS on tasks so velocity is derived from real work
-- (not hand-entered). team_velocity (0118) had committed/completed points but no
-- task-level source; this adds the leaf estimate that rolls up to sprint velocity
-- and feeds productivity/tempo metrics. Captured from the issue tracker (Jira
-- estimate / story-point field) on board sync, or set on the board. Nullable =
-- unestimated. Idempotent / re-runnable.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS story_points real;

CREATE INDEX IF NOT EXISTS idx_tasks_story_points
  ON tasks(sprint_id) WHERE story_points IS NOT NULL;
