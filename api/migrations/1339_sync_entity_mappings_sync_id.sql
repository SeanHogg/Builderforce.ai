-- 1339 · Typed entity ids, server Phase B (expand only): sync_entity_mappings.sync_id.
--
-- docs/design/typed-entity-ids.md §4. A mapping row names the server row an imported entity
-- landed as. Until now that was only `server_id` text, and every reader guessed whether the text
-- was an integer. `sync_id` is that integer key (the SyncId), stored as bigint; it is NULL when
-- the entity has no integer key:
--   - mirror and usage records (their server_id is the client UUID);
--   - tier tickets ("kind:ref");
--   - Brain run steps: stored as entity type `message` but keyed by a `brain_chat_steps` id
--     (>= STEP_ID_FLOOR = 1e12, i.e. 13+ digits), which is not a message id.
--
-- ONLY sync_entity_mappings gains the column. The log tables (sync_changes, sync_events,
-- sync_records) keep `server_id` text and are parsed at the edge.
--
-- Expand only. The Worker dual-writes server_id and sync_id; readers use
-- COALESCE(sync_id, parsed server_id), because the old Worker keeps writing rows with a NULL
-- sync_id between this migration and the deploy. Dropping server_id is the contract push (Gap
-- Register), gated on client-version telemetry.
--
-- The backfill only casts decimal text of at most 15 digits (every one a safe JS integer), so
-- the cast can never overflow. The index is plain, NOT unique: one SyncId may map to several
-- client ids (re-linked chat-ticket links, chats adopted by hint, messages adopted by eventKey).
-- Idempotent / re-runnable; reversible by DROP INDEX + DROP COLUMN.
SET LOCAL lock_timeout = '3s';

ALTER TABLE sync_entity_mappings ADD COLUMN IF NOT EXISTS sync_id bigint;

UPDATE sync_entity_mappings
   SET sync_id = server_id::bigint
 WHERE sync_id IS NULL
   AND server_id ~ '^[1-9][0-9]{0,14}$'
   AND NOT (entity_type = 'message' AND length(server_id) >= 13);

CREATE INDEX IF NOT EXISTS idx_sync_entity_mappings_sync_id
  ON sync_entity_mappings (tenant_id, entity_type, sync_id);
