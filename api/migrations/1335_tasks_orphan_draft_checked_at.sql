-- 1335 · When the orphan-draft sweep last examined a task's unrecorded draft PR (expand-only).
--
-- The sweep finds a draft whose record never landed through the task's stale PR-open claim, then asks the provider.
-- A task whose claim is stale but has nothing to settle (no repo, no draft of ours on the branch) matched the same
-- query every tick and, ordered oldest-claim-first, crowded out the tasks behind it. The sweep stamps this column on
-- every task it examined without acting, and only re-examines after the grace period.
--
-- Nullable, no default, no backfill: NULL = never examined = eligible, which is the pre-column behaviour.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS orphan_draft_checked_at TIMESTAMP;
