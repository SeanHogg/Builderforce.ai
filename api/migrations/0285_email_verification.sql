-- Email-ownership verification at signup — stops fake / unowned-email accounts.
-- New password signups start unverified and must enter a 6-digit code emailed to
-- them before they can obtain a session. OAuth / magic-link accounts are inherently
-- verified (the provider / inbox already vouches for the address).

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamp;

-- Backfill: EVERY pre-existing account is treated as already verified so no current
-- user is ever locked out. Only accounts created AFTER this migration start unverified.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       varchar(255) NOT NULL,
  code_hash   varchar(64) NOT NULL,
  expires_at  timestamp NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_codes_user_id_idx ON email_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS email_verification_codes_email_idx ON email_verification_codes(email);
