-- The durable marker of a draft PR the PLATFORM opened mid-run (ci/draftPrForCi).
--
-- The PR reconciler rewrites every row's `status` from the provider, so "status = draft" plus the task's PR
-- stamp cannot tell the platform's own early draft from a draft a human opened or converted back to draft.
-- This column can: the early draft writes the id of the execution that opened it in the same transaction as the
-- row; marking it ready (finalize adoption) and the orphan sweep clear it once they act. The sweep, the draft
-- lookup and the finalize adoption all REQUIRE it, so a row without it is never touched, whatever its status.
--
-- Expand-only: a nullable column and a partial index. No drops, no NOT NULL, no backfill (every existing row is
-- NULL = not a platform draft, which is the safe reading of a draft that predates the marker).
ALTER TABLE pull_requests
  ADD COLUMN IF NOT EXISTS platform_draft_execution_id integer;

CREATE INDEX IF NOT EXISTS idx_pull_requests_platform_draft
  ON pull_requests (tenant_id, task_id)
  WHERE platform_draft_execution_id IS NOT NULL;
