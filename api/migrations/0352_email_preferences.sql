-- Migration: email preferences — the consent record every LIFECYCLE send checks.
--
-- Today every send is TRANSACTIONAL (welcome, magic link, verification code,
-- invites, admin reset, alerts, digests): the recipient asked for it by doing
-- something, so CAN-SPAM requires no opt-out and none is offered. The moment a
-- lifecycle/marketing send exists — a tips drip, a "what's new", a re-engagement
-- nudge — it needs somewhere to check consent and a working unsubscribe. That
-- place did not exist; this table is it.
--
-- Keyed on EMAIL, not user_id. A cold workspace/chat invite goes to an address
-- with no `users` row at all, and an unsubscribe from that mail must still stick
-- — including if the person signs up later. `user_id` is therefore a nullable
-- convenience link (ON DELETE SET NULL) rather than the identity: deleting the
-- account must NOT resurrect consent for the address.
--
-- Opt-OUT semantics (columns default true) are correct here because the row is
-- only ever created for an address that already has a relationship with us. A
-- MISSING row means "no preference expressed" and the reader
-- (application/email/emailPreferences.ts) treats it as the same all-true default,
-- so this migration needs no backfill and changes no current behaviour.
--
-- `unsubscribed_all` is the CAN-SPAM global opt-out and OVERRIDES every category
-- flag — one click in the footer link stops all non-transactional mail, which is
-- what the law actually requires. It is kept separate from the per-category flags
-- so re-subscribing to one category cannot silently undo a global opt-out.
--
-- Distinct from `newsletter_subscribers`, which is the MARKETING-SITE list (an
-- address that opted into the newsletter without necessarily having an account).
-- This table is the APPLICATION's consent record for people we already mail.

CREATE TABLE IF NOT EXISTS email_preferences (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable link to the account, when the address has one. Not the identity.
  user_id           VARCHAR(36)  REFERENCES users(id) ON DELETE SET NULL,
  -- Lowercased address. The real key — one consent record per address.
  email             VARCHAR(255) NOT NULL UNIQUE,
  -- Per-category consent. Mirrors LIFECYCLE_CATEGORIES in
  -- application/email/emailPreferences.ts; adding a category means adding a
  -- column here so an unknown category can never silently default to "allowed".
  product_updates   BOOLEAN      NOT NULL DEFAULT true,
  onboarding_tips   BOOLEAN      NOT NULL DEFAULT true,
  digests           BOOLEAN      NOT NULL DEFAULT true,
  -- Global opt-out. Overrides every column above.
  unsubscribed_all  BOOLEAN      NOT NULL DEFAULT false,
  -- When the global opt-out was taken (audit trail for a CAN-SPAM complaint).
  unsubscribed_at   TIMESTAMP,
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- The read path is "given this address, may I send category X" — the UNIQUE
-- constraint on email already indexes it. This second index serves the account
-- surface (/settings?sub=email loads by user_id).
CREATE INDEX IF NOT EXISTS idx_email_preferences_user ON email_preferences(user_id);
