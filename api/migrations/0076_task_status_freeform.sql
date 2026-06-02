-- Fully configurable task boards: tasks.status moves from the fixed `task_status`
-- pg enum to a free-form varchar, so a project's swimlanes define its board
-- columns (arbitrary names / order / count) and a task can sit in any lane.
--
-- The `TaskStatus` enum stays in application code as the canonical default
-- vocabulary (the lanes seeded on board creation + the statuses automation
-- drives: in_progress / in_review / done), but the database no longer constrains
-- a task to those seven values.
--
-- Idempotent: only converts if the column is still the enum type.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'status' AND udt_name = 'task_status'
  ) THEN
    ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE tasks ALTER COLUMN status TYPE varchar(64) USING status::text;
    ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'backlog';
  END IF;
END $$;

-- task_status is now unreferenced (only tasks.status used it).
DROP TYPE IF EXISTS task_status;
