-- 0255_projects_due_date.sql
-- Project-level deadline.
--
-- Until now a project had no date column of its own: its calendar/Gantt deadline
-- was DERIVED purely from the max task due date, so a project with no dated tasks
-- showed "no deadline set" and there was no way to set one. This adds an explicit,
-- editable project deadline. The list endpoint resolves the effective deadline as
-- explicit `due_date` when set, else the derived max-task-due-date fallback — so
-- existing projects keep their derived deadline until a PM sets one.
--
-- Idempotent / re-runnable.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
