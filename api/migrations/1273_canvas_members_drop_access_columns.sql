-- 1273 · Canvas members — CONTRACT: drop the legacy access columns (pairs with 1264, 1270).
--
-- Ship ONLY once no Worker older than the one released with 1270 is serving. That
-- Worker reads board access from `memberships` only, never mirrors a role onto this
-- table, and does not declare these columns in Drizzle; 1270 carried the last window
-- writes (seats and removals) onto the kernel memberships.
--
-- Drops `role`, `invited_by`, `pinned`, `watch_state` and `joined_at` from
-- `creation_session_members`. The table KEEPS its name: it now carries presence only
-- (viewport, cursor, selection, typing, follow target, last-seen revision/time).
--
-- No removal catch-up here: once the 1270 Worker is live a board member with no row in
-- this table is normal (a presence row is optional), so "no row" no longer means
-- "removed".
--
-- Dropping `joined_at` takes `idx_creation_members_user` (user_id, joined_at) with it;
-- a plain user_id index replaces it for the per-user cascades and lookups.
--
-- Idempotent: every drop is IF EXISTS, the index IF NOT EXISTS.

ALTER TABLE creation_session_members
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS invited_by,
  DROP COLUMN IF EXISTS pinned,
  DROP COLUMN IF EXISTS watch_state,
  DROP COLUMN IF EXISTS joined_at;

CREATE INDEX IF NOT EXISTS idx_creation_members_user_id ON creation_session_members(user_id);
