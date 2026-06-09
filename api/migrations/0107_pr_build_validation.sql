-- 0107_pr_build_validation.sql
-- Post-merge build validation: after a PR is merged we record the merge commit
-- SHA so the deploy-branch CI build (whose head_sha is that merge commit) can be
-- correlated back to the task, and we track the resulting build outcome so the UI
-- can show "build passing/failing" and the auto-fix loop can react to a failure.
--   merge_sha    — the merge commit SHA on the deploy branch (correlates post-merge CI).
--   build_status — null | pending | success | failure (the post-merge build result).
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS merge_sha varchar(64);
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS build_status varchar(16);
