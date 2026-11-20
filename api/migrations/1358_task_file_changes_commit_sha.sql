-- 1358 · PRD 48 §4.6 — the platform's own record of the commits its runs wrote (EXPAND only).
--
-- WHY. A person's merge grant must merge only what the granted run wrote. The run's commit
-- SUBJECT carries a marker (`— task #N · run #M (`), but that is a public, predictable string:
-- anyone with push access to the ticket branch, or another run choosing a path, can type it. So a
-- marker is never proof. The proof is the commit SHA the provider RETURNED for the platform's own
-- write — recorded here, on the per-execution write record every cloud write already lands in.
--
-- `commit_sha` is lower-case hex, or NULL when the provider's response named no commit (and for
-- every row written before this migration). A NULL is never treated as proof. The grant binds only
-- when the PR head is a SHA recorded for the granted execution, and every commit ahead of base is
-- one recorded for a run of the same ticket.
--
-- EXPAND only: one nullable column and an index. Safe as a single push.

SET LOCAL lock_timeout = '3s';

ALTER TABLE task_file_changes ADD COLUMN IF NOT EXISTS commit_sha varchar(64);

CREATE INDEX IF NOT EXISTS idx_task_file_changes_commit
  ON task_file_changes (tenant_id, task_id, commit_sha) WHERE commit_sha IS NOT NULL;
