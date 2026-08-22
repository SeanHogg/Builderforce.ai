-- Calendar OAuth grants move into the sealed token vault (PRD 20 §4).
--
-- `calendar_connections` stored `access_token` and `refresh_token` as plain text
-- while every other per-user connection in the platform — `mailbox_connections`,
-- `drive_connections` — seals the same grant with `token_enc` / `token_iv` through
-- `application/integrations/oauthTokenVault`. A refresh token is the long-lived
-- half: it re-mints access tokens until the user revokes consent, so plaintext at
-- rest is the worst of the two to leave lying about, and it was the one stored
-- alongside its own access token.
--
-- ROLLING, NOT BIG-BANG. Sealing needs the tenant's key, which only the Worker
-- holds, so this migration cannot re-encrypt the existing rows itself. Instead the
-- sealed columns arrive NULLABLE, the plaintext columns are kept and made
-- nullable, and the read path prefers the sealed blob and falls back to plaintext,
-- re-sealing the row the first time it is touched. `access_token` also loses its
-- NOT NULL, because a row written after this point has nothing to put in it.
--
-- The plaintext columns are dropped by a follow-up migration once the backfill has
-- drained — deliberately a separate step, so a rollback of the code does not strand
-- grants the old path can no longer read.

ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS token_enc text;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS token_iv  text;

ALTER TABLE calendar_connections ALTER COLUMN access_token DROP NOT NULL;

-- Rows still to be sealed. The partial index is what makes "is the backfill done"
-- a cheap question to ask, rather than a sequential scan over every grant.
CREATE INDEX IF NOT EXISTS idx_calendar_connections_unsealed
  ON calendar_connections (tenant_id)
  WHERE token_enc IS NULL;
