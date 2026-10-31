-- 1291 · Two nullable columns the campaign sweeps need (expand only, 2 columns).
--
--   marketing_campaign_sends.claimed_at     When a runner claimed the row (`queued` → `sending`). The sweep moves a row that
--                                           has been `sending` for longer than STALE_CLAIM_AFTER_MS to `failed`: a Worker
--                                           evicted between the claim and the write-back otherwise leaves the row `sending`
--                                           forever, the campaign can never reach zero rows outstanding, and it is advanced
--                                           (and the cron gate re-signalled) on every tick. A row claimed before this
--                                           migration has NULL here and is reaped on the same terms.
--   marketing_campaigns.schedule_refused_at When the scheduled-start sweep last REFUSED this campaign (a lapsed sender, an
--                                           emptied audience). A refused draft keeps its past `scheduled_at` by design, so it
--                                           stays due; the sweep orders never-refused campaigns first, so five permanently
--                                           refused drafts cannot occupy its whole per-tick limit and starve every other
--                                           scheduled send. Cleared when the campaign is edited or started.
--
-- Safe against the OLD Worker, which runs against this schema until the deploy completes: both columns are nullable with no
-- default, so ADD COLUMN is a metadata-only change (no table rewrite) and the old code's INSERTs/UPDATEs, which name neither
-- column, are unaffected. Nothing reads them yet. ADD COLUMN takes ACCESS EXCLUSIVE on the table for an instant; migrate.mjs runs
-- the file as one transaction, so `SET LOCAL lock_timeout` bounds the wait for that lock and a timeout rolls the file back and
-- fails the deploy cleanly (re-run it). Reversible by DROP COLUMN.
SET LOCAL lock_timeout = '3s';

ALTER TABLE marketing_campaign_sends ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS schedule_refused_at TIMESTAMP;
