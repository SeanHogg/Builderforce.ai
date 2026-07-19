-- 0261_error_events_source.sql
-- Persist WHICH adapter produced each error event (native SDK / OTLP / Sentry /
-- PostHog / LogRocket). The canonical event (errorSpec.NormalizedErrorEvent)
-- already carries `source`, but the ingest engine dropped it on the way into
-- error_events, so the Quality dashboard could only break volume down by
-- COLLECTOR, not by SOURCE. This column unblocks the "data collected by source"
-- donut on the collectors card and a by-source aggregate in /api/quality/stats.
--
-- Backfill: existing rows keep their raw adapter id in payload->>'source'; use it
-- where present, else 'native' (the pre-provider default ingest path).
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS + guarded backfill.

ALTER TABLE error_events ADD COLUMN IF NOT EXISTS source varchar(32);

UPDATE error_events
   SET source = COALESCE(NULLIF(payload->>'source', ''), 'native')
 WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_error_events_tenant_source ON error_events(tenant_id, source);
