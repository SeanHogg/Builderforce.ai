-- Migration 0071: cross-domain (channel-3) seams between BurnRateOS and
-- BuilderForce (spec 05 §4).
--
--   * customer_feedback     — Voice-of-Customer events the host PUSHES to
--                            BuilderForce (POST /v1/ingest/feedback); the founder
--                            triages them into the backlog.
--   * webhook_subscriptions — host subscriptions to BuilderForce outbound events
--                            (workitem.released / sprint.completed / roadmap.published).
--   * webhook_deliveries    — per-delivery audit row. Its id doubles as the
--                            replay nonce carried in the signature.
--
-- All three are Segment-scoped with ON DELETE CASCADE so the 0070-era DSR
-- erasure (DELETE /api/segments/:id) wipes them with everything else.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS customer_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  -- Host's event id — unique per segment so re-delivery is idempotent.
  external_ref  VARCHAR(255) NOT NULL,
  widget_id     VARCHAR(255),
  text          TEXT NOT NULL,
  sentiment     VARCHAR(32),
  contact       VARCHAR(320),
  status        VARCHAR(16) NOT NULL DEFAULT 'new',  -- new | triaged | dismissed
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customer_feedback_ref UNIQUE (segment_id, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_segment ON customer_feedback(segment_id, status);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  -- HMAC secret used to sign deliveries to this endpoint.
  secret       VARCHAR(128) NOT NULL,
  -- JSON array of subscribed event types.
  events       TEXT NOT NULL DEFAULT '[]',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_segment ON webhook_subscriptions(segment_id, active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- also the replay nonce
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  event_type      VARCHAR(64) NOT NULL,
  event_id        VARCHAR(255) NOT NULL,  -- logical source id (dedupe at the receiver)
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  response_status INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id, created_at);
