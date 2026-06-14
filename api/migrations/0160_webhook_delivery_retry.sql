-- 0160_webhook_delivery_retry.sql
-- Outbound webhook deliveries (emitWebhookEvent — cross-domain seams, spec 05 §4.3)
-- were best-effort: a transient receiver outage marked the row `failed` and
-- nothing ever redelivered it, so the event was lost permanently. This adds the
-- state a cron sweep needs to retry failed/pending rows with capped exponential
-- backoff (at-least-once delivery):
--   - payload:       the exact signed POST body, so a retry re-sends identical
--                    bytes under the SAME delivery-id nonce (receiver dedupes);
--   - next_retry_at: when the row is next eligible for a retry. NULL is terminal
--                    (delivered, or the attempt budget is exhausted);
--   - last_error:    the most recent failure reason, for observability.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload       text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_error    text;

-- The sweep selects due, non-terminal rows (WHERE next_retry_at <= now()). A
-- partial index keeps it cheap as the delivery log grows — terminal rows (the
-- vast majority over time) carry next_retry_at = NULL and are excluded.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries (next_retry_at) WHERE next_retry_at IS NOT NULL;

-- No backfill: rows that predate this migration have payload = NULL, so they
-- cannot be faithfully re-signed and are intentionally left terminal. Retry
-- scheduling begins with the first delivery emitted after this migration.
