-- 1290 · Partial index for the scheduled-social-campaign probe (expand only, 1 index).
--
-- cronWorkSignal's SCHEDULE_SOURCES now publishes the earliest armed `social_campaigns.scheduled_at` to the KV gate at the end of
-- every active tick: `SELECT MIN(scheduled_at) FROM social_campaigns WHERE status IN ('scheduled') AND scheduled_at IS NOT NULL`.
-- The only existing index is (tenant_id, status, updated_at), which cannot serve a cross-tenant MIN over send time, so the probe
-- would scan the table. This partial index (mirroring idx_marketing_campaigns_due, 0940) holds exactly the armed rows, so the
-- probe is a top-of-index read and socialCampaignsDue's scheduled branch can use it too. The probe's WHERE implies the predicate
-- (status 'scheduled' comes from campaignLifecycle's social `dueStatuses`; the probe adds scheduled_at IS NOT NULL).
-- Adds an index only: nothing the old Worker runs depends on it. A plain CREATE INDEX takes a SHARE lock on social_campaigns
-- (blocking writes) while it builds; migrate.mjs runs the file as one transaction, so `SET LOCAL lock_timeout` bounds the wait for
-- that lock and a timeout rolls the file back and fails the deploy cleanly (re-run it). Reversible by DROP INDEX.
SET LOCAL lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS idx_social_campaigns_due
  ON social_campaigns (scheduled_at)
  WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;
