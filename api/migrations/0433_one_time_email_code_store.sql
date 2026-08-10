-- 0433_one_time_email_code_store.sql
--
-- One one-time email code store (PRD 20 §0).
--
-- `check-signature-duplication.mjs` scored the new `email_otp_challenges`
-- against the existing `email_verification_codes` at 0.62 — over the 0.55 gate —
-- and it was right: they were the same table. One was issued at password signup
-- to prove ownership of an address (migration 0285), the other for a newsletter
-- double opt-in and a gated download. Same code, same hash-only storage, same
-- expiry, same attempt cap, same single-use rule. The only difference was which
-- feature asked, and that is a `purpose` column.
--
-- This is the rule from §0 applied to a table that ALREADY EXISTED rather than
-- only to the new one, which is the whole point of landing the guard before the
-- merge instead of after it.
--
-- NO tenant_id, and the predecessor had none either: a signup challenge is
-- issued before the account exists, so there is no tenant to scope it to. The
-- scope is (user_ref, purpose), which is narrower than tenant rather than
-- looser. `check-tenant-column.mjs` records that as a decision.
--
-- Rows carry across. Nothing is dropped before it is copied, and the copy is
-- idempotent, so a replay against an environment that already ran this is a
-- no-op rather than a duplicate-key failure.

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id SERIAL PRIMARY KEY,
  purpose VARCHAR(48) NOT NULL DEFAULT 'signup_verification',
  email VARCHAR(320) NOT NULL,
  user_ref VARCHAR(64),
  code_hash VARCHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migration 0432 originally introduced the marketing-only shape first. On an
-- upgrade, CREATE TABLE IF NOT EXISTS preserves that table rather than adding
-- identity's user reference, so converge the shared store before indexing or
-- copying signup challenges. Fresh databases take the same idempotent path.
ALTER TABLE email_otp_challenges
  ADD COLUMN IF NOT EXISTS user_ref VARCHAR(64);
ALTER TABLE email_otp_challenges
  ALTER COLUMN purpose SET DEFAULT 'signup_verification';

CREATE INDEX IF NOT EXISTS idx_email_otp_challenges_user ON email_otp_challenges (user_ref, consumed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_email_otp_challenges_email ON email_otp_challenges (email, purpose, expires_at);

-- Carry the signup codes across. A SHA-256 of a random six-digit code does not
-- repeat inside the 15-minute TTL, so the hash is a sound replay guard here; a
-- stale collision would be an already-expired row either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_verification_codes') THEN
    INSERT INTO email_otp_challenges (purpose, email, user_ref, code_hash, attempts, consumed_at, expires_at, created_at)
    SELECT 'signup_verification', old.email, old.user_id, old.code_hash, old.attempts, old.consumed_at, old.expires_at, old.created_at
    FROM email_verification_codes AS old
    WHERE NOT EXISTS (
      SELECT 1 FROM email_otp_challenges AS moved
      WHERE moved.code_hash = old.code_hash AND moved.purpose = 'signup_verification'
    );
  END IF;
END $$;

DROP TABLE IF EXISTS email_verification_codes;
