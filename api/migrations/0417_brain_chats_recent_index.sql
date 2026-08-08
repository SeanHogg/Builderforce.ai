-- Brain chat list — an index that actually serves the ordering.
--
-- WHY: `BrainService.listChats` is the hot read behind every chat list. It filters
-- on (tenant_id, origin, is_archived) plus a visibility predicate, then does
-- `ORDER BY updated_at DESC LIMIT n OFFSET m`. Every existing index on the table
-- covers the equality columns only — idx_brain_chats_tenant (tenant_id),
-- idx_brain_chats_user_id (user_id), idx_brain_chats_project_id (project_id) and
-- idx_brain_chats_team_scope from 0294 — and NONE of them contains updated_at.
-- So Postgres reads every non-archived chat in the tenant and sorts the lot to
-- return the first page, on a paginated path that gets hit on each surface load.
-- The equivalent read on the canvas side has had a matching composite since it
-- was written: idx_creation_sessions_creator (created_by, last_activity_at).
--
-- Partial on is_archived = false because archived chats are never in this list,
-- which keeps the index to the working set rather than the whole table.
--
-- Ordering matters ahead of the consolidated left-panel "Recents" list, which
-- unions creation_sessions with brain_chats on their shared (title, mode,
-- activity) shape — a union is only as fast as its slower half.

CREATE INDEX IF NOT EXISTS idx_brain_chats_tenant_origin_recent
  ON brain_chats (tenant_id, origin, updated_at DESC)
  WHERE is_archived = false;
