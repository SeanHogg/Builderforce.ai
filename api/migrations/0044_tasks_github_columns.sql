-- Migration 0044: Tasks ↔ GitHub linkage columns.
--
-- The Drizzle schema declares github_issue_number / github_issue_url /
-- github_pr_number / github_pr_url on `tasks`, but no prior migration
-- created them — production DB is missing the columns and every task-list
-- query 500s with: column "github_issue_number" does not exist.
--
-- Idempotent: safe to re-run.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS github_issue_number INTEGER,
  ADD COLUMN IF NOT EXISTS github_issue_url    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS github_pr_number    INTEGER,
  ADD COLUMN IF NOT EXISTS github_pr_url       VARCHAR(500);

-- Idempotency partial index used by the GitHub webhook to dedupe
-- (one task per issue per project).
CREATE INDEX IF NOT EXISTS idx_tasks_github_issue
  ON tasks(project_id, github_issue_number)
  WHERE github_issue_number IS NOT NULL;
