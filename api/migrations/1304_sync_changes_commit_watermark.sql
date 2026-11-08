-- 1304_sync_changes_commit_watermark.sql
--
-- WHY. `sync_changes.seq` is a bigserial: a sequence value is taken when the row is
-- INSERTED, but the row only becomes visible when its transaction COMMITS, and the two
-- orders differ. Transaction A takes seq 10 and is still open; transaction B takes 11
-- and commits; a pull delivers 11 and moves the cursor to 11; A then commits 10 and that
-- change is never delivered (a silently lost sync change).
--
-- The fix is a commit-ordered watermark on the writing transaction's id. `txid` is the
-- 64-bit `xid8` of the transaction that wrote the row (filled by the column default
-- INSIDE that transaction, so the application never sets it). The pull cursor becomes
-- the tuple (txid, seq) and a delta page only reads rows with
--   txid < pg_snapshot_xmin(pg_current_snapshot())
-- Every transaction below that xmin has finished and every transaction that starts later
-- gets an xid >= it, so nothing can still commit underneath the cursor.
--
--   WHERE tenant_id = $1 AND destination_key = $2
--     AND (txid, seq) > ($3::xid8, $4)
--     AND txid < pg_snapshot_xmin(pg_current_snapshot())
--   ORDER BY txid, seq LIMIT n
--
-- Existing rows are backfilled with the constant xid8 '0': that is an INSTANT metadata
-- change (a volatile default such as pg_current_xact_id() would rewrite the whole table
-- under an ACCESS EXCLUSIVE lock), those rows are by definition already committed, and
-- '0' keeps them in their original seq order ahead of every new row. The default is then
-- switched to pg_current_xact_id() for rows written from now on.
--
-- LIVENESS. A row is withheld while ANY transaction with a lower xid is still open anywhere in
-- the database (not just a sync writer): a long-running transaction elsewhere delays delivery
-- until it ends. Rows are withheld, never lost. Pull reports an xmin that lags the next xid by
-- more than 10,000 transactions (SyncPullRepository, `syncPull:xminHeldBack`).
--
-- LEGACY CURSORS. A pre-1304 cursor is a bare seq S. The new pull translates it to (0, S)
-- WITHOUT looking the row up: rows written in the migration window by the previous Worker carry
-- real txids that need not follow seq, so anchoring S on its own row's txid would skip them.
-- Re-delivery is a plain re-put on the client.
--
-- EXPAND ONLY (expand/contract). The old indexes are KEPT here: the Worker deploys after
-- migrations, so the previous release's pull still reads through them until the new Worker is
-- live. The new pull reads ONLY idx_sync_changes_destination_txid: it no longer takes MAX(seq)
-- per tenant nor looks a row up by (tenant_id, seq). The CONTRACT push (a later migration)
-- therefore drops BOTH idx_sync_changes_destination (tenant_id, destination_key, seq; 1251)
-- and idx_sync_changes_cursor (tenant_id, seq; 1247).
--
-- No `CREATE INDEX CONCURRENTLY` (as 1134/1256): the runner wraps each file in one transaction
-- and CONCURRENTLY cannot run inside one. A plain build locks writes to sync_changes for its
-- duration, which is acceptable because sync_changes is swept at 30 days
-- (SYNC_CHANGE_RETENTION_DAYS), so the table stays small, and the build is a single sorted scan.
--
-- DOWN.
--   DROP INDEX IF EXISTS idx_sync_changes_destination_txid;
--   ALTER TABLE sync_changes DROP COLUMN IF EXISTS txid;

ALTER TABLE sync_changes
  ADD COLUMN IF NOT EXISTS txid xid8 NOT NULL DEFAULT '0'::xid8;

ALTER TABLE sync_changes
  ALTER COLUMN txid SET DEFAULT pg_current_xact_id();

CREATE INDEX IF NOT EXISTS idx_sync_changes_destination_txid
  ON sync_changes (tenant_id, destination_key, txid, seq);
