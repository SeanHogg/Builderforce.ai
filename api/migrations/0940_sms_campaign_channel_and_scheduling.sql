-- 0940 — An SMS campaign channel, and a `scheduled_at` that is actually read.
--
-- ── TWO GAPS, ONE MIGRATION, BECAUSE THEY ARE THE SAME TABLE ────────────────
-- Both are ROADMAP entries under "Connected mailboxes & campaign studio", and
-- both are columns on the campaign/audience pair. Splitting them would mean two
-- ALTERs on `marketing_campaigns` in the same week for no reader's benefit.
--
-- ── WHY AN AUDIENCE COULD NOT HOLD A PHONE NUMBER ───────────────────────────
-- `marketing_audience_members` was email-only by construction: `email` is NOT
-- NULL and is the uniqueness key, and there was no phone column at all. So the
-- Twilio connector's `send_sms` action — live, and callable by agents and
-- workflows since it shipped — had no path from an AUDIENCE, and "send this
-- campaign as an SMS to the same list" was unwriteable rather than unbuilt.
--
-- The person is still keyed by EMAIL. A phone is an ATTRIBUTE of the member, not
-- a second identity: keying SMS by number would let the same human appear twice
-- in one audience, and `marketing_campaign_sends`'s (campaign, email) uniqueness
-- — the thing that makes a resumed send idempotent — would stop meaning "one
-- message per person".
--
-- `phone_status` is separate from `status` because consent is PER CHANNEL. A
-- carrier STOP withdraws consent to text somebody; it says nothing about the
-- newsletter they subscribed to, and collapsing the two would silently
-- unsubscribe them from both. It is also why a STOP does NOT write a
-- `marketing_suppressions` row: that table is the tenant-wide email
-- do-not-contact list, and an SMS opt-out is not an email opt-out.
--
-- ── WHY `channel` AND `transport` ARE TWO COLUMNS ───────────────────────────
-- `transport` already answers "which pipe" (platform / mailbox / sendgrid).
-- `channel` answers "what kind of message", which decides an entirely different
-- set of facts: which recipient field is addressed, which body column is sent,
-- whether the open pixel and click rewrite mean anything, and what "delivered"
-- is even reported by. One column carrying both would make "is this campaign
-- sendable?" a cross-product rather than two checks.
--
-- ── WHY SMS GETS ITS OWN BODY COLUMN ────────────────────────────────────────
-- `body_html` is HTML, and an SMS is not. Deriving the text by stripping tags —
-- which is what the mailbox transport does for an email's plain-text ALTERNATIVE
-- — is lossy in the one direction that matters here: the author is composing the
-- 160 characters that get delivered, not a fallback for them.
--
-- ── DELIVERY IS REPORTED, NOT INFERRED ──────────────────────────────────────
-- An email's engagement is an open pixel and a click rewrite. Neither exists for
-- SMS: the carrier reports back asynchronously instead, which is what
-- `external_message_id` / `delivery_status` / `delivered_at` record. Twilio's
-- status callback is addressed by the send's existing `track_token`, so no new
-- identifier is minted and the callback resolves to exactly one row.

ALTER TABLE marketing_audience_members
  ADD COLUMN IF NOT EXISTS phone        VARCHAR(32),
  ADD COLUMN IF NOT EXISTS phone_status VARCHAR(16) NOT NULL DEFAULT 'subscribed';

-- Serves the SMS materialisation ("every member of this audience with a usable
-- number"), which the email path's index cannot answer.
CREATE INDEX IF NOT EXISTS idx_marketing_audience_members_phone
  ON marketing_audience_members (audience_id, phone_status)
  WHERE phone IS NOT NULL;

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS channel     VARCHAR(16) NOT NULL DEFAULT 'email',
  -- The E.164 number an SMS campaign sends FROM. Denormalised for the same
  -- reason `from_name` is: it is a historical fact about what recipients saw,
  -- and renaming or releasing the Twilio number later must not rewrite it.
  ADD COLUMN IF NOT EXISTS from_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS body_text   TEXT NOT NULL DEFAULT '';

-- The scheduled sweep asks one question — "which drafts are due?" — and asked it
-- of an index that did not exist, because until now nothing asked it at all.
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_due
  ON marketing_campaigns (scheduled_at)
  WHERE status = 'draft' AND scheduled_at IS NOT NULL;

ALTER TABLE marketing_campaign_sends
  -- The number actually messaged, recorded per send rather than read back off
  -- the member: a member who changes their number later must not make the
  -- delivery ledger describe a message that went somewhere else.
  ADD COLUMN IF NOT EXISTS phone               VARCHAR(32),
  -- The carrier's own id for the message, which is what a support conversation
  -- with Twilio is conducted in.
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(64),
  -- The last status the carrier reported: queued | sent | delivered | undelivered
  -- | failed. Distinct from `status`, which is OUR send-loop state — "we handed
  -- it over" and "it arrived" are different claims and only one of them is ours.
  ADD COLUMN IF NOT EXISTS delivery_status     VARCHAR(24),
  ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMP;
