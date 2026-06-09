-- 0106_pull_request_merge_audit.sql
-- In-product "Approve & Merge": when a human merges a recorded pull request from
-- the Pull Request tab, capture WHO approved it and WHEN for audit. Both columns
-- are nullable — an open PR (or one merged by the legacy auto-merge path) has no
-- human approver.
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS merged_by varchar(128);
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS merged_at timestamp;
