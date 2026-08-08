-- Kernel extras — the statements the DDL generator cannot derive.
--
-- 1. Self-referencing foreign keys. Drizzle needs an explicit type annotation to
--    let a table reference itself, which the lexical parser in ddlFromDrizzle.mjs
--    will not read. The constraint belongs in the database regardless, and this
--    is where it goes.
-- 2. `activity_log` already had a CREATE TABLE (migration 0287, single audit
--    store since 0295), so its new registry column arrives as an ADD COLUMN.

ALTER TABLE objects DROP CONSTRAINT IF EXISTS fk_objects_parent;
ALTER TABLE objects ADD CONSTRAINT fk_objects_parent
  FOREIGN KEY (parent_id) REFERENCES objects(id) ON DELETE CASCADE;

ALTER TABLE annotations DROP CONSTRAINT IF EXISTS fk_annotations_parent;
ALTER TABLE annotations ADD CONSTRAINT fk_annotations_parent
  FOREIGN KEY (parent_id) REFERENCES annotations(id) ON DELETE CASCADE;

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS fk_work_items_parent;
ALTER TABLE work_items ADD CONSTRAINT fk_work_items_parent
  FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS fk_runs_parent;
ALTER TABLE runs ADD CONSTRAINT fk_runs_parent
  FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE CASCADE;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS fk_artifacts_derived_from;
ALTER TABLE artifacts ADD CONSTRAINT fk_artifacts_derived_from
  FOREIGN KEY (derived_from_id) REFERENCES artifacts(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_reply_to;
ALTER TABLE messages ADD CONSTRAINT fk_messages_reply_to
  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;

-- The registry reference the (target_type, target_id) pair could never enforce.
-- `activity_log` predates the kernel (migration 0287) and is declared on BOTH
-- tracks, so the column is added on both: here with a real foreign key into
-- `objects`, and in transactional-migrations/0004 without one, because the
-- operational database has no `objects` table to point at. Nullable either way —
-- rows written before their target was registered keep the (target_type,
-- target_id) pair only.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS object_id UUID;
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS fk_activity_log_object;
ALTER TABLE activity_log ADD CONSTRAINT fk_activity_log_object
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_activity_log_object ON activity_log (object_id, occurred_at);
