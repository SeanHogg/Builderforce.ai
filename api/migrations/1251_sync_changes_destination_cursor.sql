-- 1251_sync_changes_destination_cursor.sql
--
-- WHY. The sync pull (offline-first PRD, G18) reads `sync_changes` per
-- DESTINATION, not per tenant: a delta page is
--   WHERE tenant_id = $1 AND destination_key = $2 AND seq > $3 ORDER BY seq LIMIT n
-- and the cursor-expiry check is MIN(seq) for that same (tenant, destination).
-- 1247 only indexed (tenant_id, seq), so both walked every destination's rows of
-- the tenant. The tenant tip (MAX(seq) per tenant) keeps using 1247's index.
--
-- DOWN. DROP INDEX IF EXISTS idx_sync_changes_destination;

CREATE INDEX IF NOT EXISTS idx_sync_changes_destination
  ON sync_changes (tenant_id, destination_key, seq);
