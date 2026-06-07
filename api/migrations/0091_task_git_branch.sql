-- 0091_task_git_branch.sql
-- The git branch the agent executes a ticket under (e.g. builderforce/task-123).
-- Surfaced on the ticket Details as a hyperlink to the code changes (the PR /
-- branch). Set when the branch is first created (PRD commit or a runtime push).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS git_branch text;
