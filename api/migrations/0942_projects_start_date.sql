-- 0942_projects_start_date.sql
-- The other half of a project-level schedule.
--
-- 0255 gave `projects` an explicit `due_date` so a PM could state a deadline the
-- tasks had not yet earned. It stopped there, and the asymmetry is exactly what
-- made the Gantt read-only: a bar has two ends, and only one of them was
-- writable. Dragging a project bar had nowhere to persist the new START, so the
-- timeline could show a project's window and never let anyone move it.
--
-- The resolution rule mirrors `due_date` precisely — explicit column when set,
-- else the DERIVED aggregate over the project's tasks (earliest task start,
-- falling back to the earliest task due date). Existing projects keep their
-- derived start until somebody sets one, so nothing on any board moves the day
-- this lands.
--
-- Deliberately NOT backfilled from the derived value. Copying today's aggregate
-- into the column would freeze it: a project whose start is derived tracks its
-- tasks as they are re-planned, and a project whose start is explicit does not.
-- Turning every project into the second kind, silently, is a schedule change to
-- every workspace on the platform disguised as a migration.
--
-- Idempotent / re-runnable.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date TIMESTAMP;

COMMENT ON COLUMN projects.start_date IS
  'Explicit PM-set project start. NULL = derived from the project''s tasks (earliest task start, else earliest task due date), exactly as due_date falls back to the latest task due date.';
