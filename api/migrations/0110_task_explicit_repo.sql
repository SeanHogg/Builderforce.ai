-- 0110_task_explicit_repo.sql
-- Run-time repo selection: a task may pin WHICH of its project's repositories the
-- agent runs against, instead of always falling back to the project default /
-- most-recent. This is the "explicit" tier of the existing pure resolver
-- (resolveRepoForTask) — until now there was no column to drive it, so a wrong
-- binding (e.g. a website-audit task pointed at `agent-runtime`) could only be
-- fixed by changing the project default. Sticky on the task so the run, finalize
-- (PR), CI auto-fix, and PRD commit all target the SAME repo (they all resolve
-- through resolveDefaultRepoForTask). Nullable + ON DELETE SET NULL so deleting a
-- repo un-pins it (the run falls back to inferred/default) rather than orphaning.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS explicit_repo_id uuid REFERENCES project_repositories(id) ON DELETE SET NULL;
