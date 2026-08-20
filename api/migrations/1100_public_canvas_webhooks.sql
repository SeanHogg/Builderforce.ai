-- 1100 — Make the outbound-webhook primitive serve the PUBLIC canvas API, and make
--        replay safety a database fact rather than a habit.
--
-- ── WHY NOT A SECOND DELIVERY LOOP ───────────────────────────────────────────
-- `webhook_subscriptions` + `webhook_deliveries` already exist and already do the
-- hard part: a persisted body, an HMAC over `${delivery_id}.${timestamp}.${body}`,
-- capped exponential backoff, a dead-letter at six attempts, and a cron sweep that
-- redelivers under the ORIGINAL nonce. Writing a second one for canvas events
-- would mean two backoff curves, two header schemes and two answers to "did this
-- one land" — and only one of them would ever get the next bug fix.
--
-- So the primitive is generalised in place. Three facts were baked into it by its
-- first and only caller (the BurnRateOS channel-3 seams) and are now lifted:
--
--   1. SEGMENT WAS MANDATORY. A subscription and a delivery both required a
--      `segment_id`, because the seam resolves a named end-client before it emits.
--      A canvas board's `segment_id` is nullable — a board is tenant-owned and a
--      workspace segment is optional context — so a tenant-wide subscription over
--      board events was unrepresentable. Both columns become nullable and the
--      TENANT becomes the scope that is always there.
--
--   2. THERE WAS NO WAY TO WATCH ONE BOARD. Miro scopes a webhook to a board, and
--      an integration that must receive every item event in the workspace to react
--      to one board is an integration that gets switched off. `session_id`
--      narrows a subscription to a single canvas; NULL keeps the tenant-wide
--      behaviour every existing row already has.
--
--   3. THE KEY THAT CREATED IT WAS NOT RECORDED. Subscriptions minted through
--      `/api/v1` are created by a `tenant_api_keys` credential, not a person, and
--      "which key registered this endpoint" is the first question asked when one
--      starts leaking events to a vendor whose contract ended.
--
-- ── THE UNIQUE INDEX IS THE REPLAY GUARD ─────────────────────────────────────
-- An at-least-once emitter meeting a caller that retries is how a webhook receiver
-- sees the same board event twice, and a receiver that creates a record per
-- delivery then creates two. The emit path could check for an existing row first —
-- and would lose the race that matters, because two concurrent retries both read
-- "not seen", both pass, and both POST. Only the index can arbitrate that, so the
-- index IS the guard and the emit path inserts with ON CONFLICT DO NOTHING.
--
-- Keyed on (subscription, event_type, event_id) because a delivery's identity is
-- "this subscriber, this event". Canvas emitters compose `event_id` from the
-- board's own monotonic revision (`<sessionId>.<revision>.<objectId>`), so a
-- retried API call that resolves to the same revision resolves to the same event
-- id and collides here instead of duplicating.
--
-- Existing rows are deduped first, keeping the earliest of each group: the survivor
-- is the one whose id was already signed and sent, so preserving it keeps every
-- receiver's own nonce history valid.

-- ── Dedupe before the constraint can be created ──────────────────────────────
DELETE FROM webhook_deliveries d
USING webhook_deliveries keeper
WHERE d.subscription_id = keeper.subscription_id
  AND d.event_type      = keeper.event_type
  AND d.event_id        = keeper.event_id
  AND (d.created_at, d.id) > (keeper.created_at, keeper.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_delivery_event
  ON webhook_deliveries (subscription_id, event_type, event_id);

-- ── Tenant becomes the scope that is always present ──────────────────────────
ALTER TABLE webhook_subscriptions ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE webhook_deliveries    ALTER COLUMN segment_id DROP NOT NULL;

-- ── Board-scoped subscriptions, and the credential that registered them ──────
ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES creation_sessions(id) ON DELETE CASCADE;
ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS description varchar(255);
ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS created_by_key_id uuid REFERENCES tenant_api_keys(id) ON DELETE SET NULL;

-- The emit path's own predicate: "active subscriptions in this tenant". It ran
-- against `segment_id` alone before, which is a uuid and so was selective by
-- accident rather than by index.
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_active
  ON webhook_subscriptions (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_session
  ON webhook_subscriptions (session_id) WHERE session_id IS NOT NULL;

-- The deliveries LOG a tenant reads back: "what did we send you, and did it land".
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created
  ON webhook_deliveries (tenant_id, created_at DESC);
