-- 1127 · Make `idx_activity_log_object` partial (primary mirror of transactional 0010).
--
-- `activity_log` exists on BOTH endpoints and the Drizzle schema is shared, so the index
-- definition has to match on both or the schema-drift guard sees one of them as wrong.
-- Primary's copy is empty as of this pass — its 85,359 rows were migrated to the
-- transactional endpoint, where every reader looks — so here this is a definition fix
-- rather than a reclaim.
--
-- See transactional-migrations/0010 for the reasoning: a btree indexes NULLs, and
-- `object_id` has never been written, so the full index was one entry per row pointing at
-- nothing. `object_id = $1` implies NOT NULL, so the partial index still serves
-- `/api/objects/:id/activity`.
DROP INDEX IF EXISTS idx_activity_log_object;
CREATE INDEX idx_activity_log_object ON activity_log (object_id, occurred_at)
  WHERE object_id IS NOT NULL;
