-- Replay guard for feedback provider webhooks — one row per accepted delivery.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
-- Webhook senders retry. Sentry and PostHog both re-deliver on a timeout or a
-- 5xx, and a slow database on our side is enough to earn a second copy of an
-- event we already processed. Every accepted delivery on this path can open a
-- BACKLOG TICKET, so an at-least-once sender meeting a non-idempotent receiver
-- puts duplicate cards in front of a human — the failure that makes a team turn
-- the integration off and go back to copying requests by hand.
--
-- ── WHY THE SUBMISSION FINGERPRINT IS NOT ENOUGH ────────────────────────────
-- `feedback_submissions.fingerprint` already collapses identical PROSE, and it
-- catches the easy retry. It cannot catch the rest, in either direction:
--
--   • A retry whose payload changed between attempts (the issue was resolved, the
--     survey answer was edited) hashes differently and would open a second ticket
--     — yet it is the same EVENT and must collapse.
--   • Two different people can legitimately file the same sentence. Fingerprint
--     collapse is the right answer there, but it is a CONTENT judgement, not a
--     delivery one, and conflating the two makes neither adjustable.
--
-- So the delivery identity is stored separately, keyed by the provider's own
-- event id (or a SHA-256 of the raw body when a provider sends none).
--
-- ── WHY A UNIQUE INDEX RATHER THAN A LOOKUP ─────────────────────────────────
-- The route INSERTS first and treats a unique violation as "already handled".
-- A read-then-write check loses the race that matters: two concurrent retries
-- both read "not seen", both pass, and both open a ticket. The index is the only
-- thing that can arbitrate that, so it is the guard rather than a report on it.

CREATE TABLE IF NOT EXISTS feedback_webhook_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collector_id  uuid NOT NULL REFERENCES feedback_collectors(id) ON DELETE CASCADE,
  provider      varchar(32) NOT NULL,
  -- The provider's own delivery id, or a SHA-256 hex of the raw body when it sends
  -- none. Bounded at 200 so a hostile sender cannot make the dedupe key the
  -- expensive part of the request.
  event_id      varchar(200) NOT NULL,
  -- The submission this delivery produced, if any. NULL is a legitimate outcome:
  -- an event the adapter does not import (an analytics event with no feedback in
  -- it) is still RECORDED, so its retries stay a single index hit instead of
  -- re-running the adapter every time.
  submission_id uuid REFERENCES feedback_submissions(id) ON DELETE SET NULL,
  created_at    timestamp NOT NULL DEFAULT now()
);

-- THE guard. Scoped to (collector, provider) rather than to event_id alone,
-- because event ids are only unique within one provider's namespace and two
-- providers may well hand out the same uuid-shaped string.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_webhook_delivery
  ON feedback_webhook_deliveries (collector_id, provider, event_id);

-- Tenant-scoped recency: "what has this workspace imported lately", and the
-- predicate any retention sweep will filter on.
CREATE INDEX IF NOT EXISTS idx_feedback_webhook_deliveries_tenant
  ON feedback_webhook_deliveries (tenant_id, created_at);
