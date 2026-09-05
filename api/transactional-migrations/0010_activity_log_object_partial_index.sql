-- 0010 · Make `idx_activity_log_object` partial.
--
-- A btree indexes NULLs. `activity_log.object_id` is NULL on every one of the 624,491
-- rows in this database — no writer has ever set it (the column exists for PRD 20 §6.3's
-- object registry and `ActivityInput.objectId` is optional) — so the index held one entry
-- per row, 19 MB of pointers to nothing, in service of `/api/objects/:id/activity`.
--
-- The predicate costs that endpoint nothing: `object_id = $1` implies `object_id IS NOT
-- NULL`, which the planner uses to prove the partial index applies. The index simply stays
-- near-empty until a writer starts populating the column, and grows only with rows that
-- actually carry one.
DROP INDEX IF EXISTS idx_activity_log_object;
CREATE INDEX idx_activity_log_object ON activity_log (object_id, occurred_at)
  WHERE object_id IS NOT NULL;
