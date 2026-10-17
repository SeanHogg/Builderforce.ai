-- 1218 · Drop calendar_connections plaintext token columns.
--
-- Migration 1107 added token_enc / token_iv and a fallback read of access_token /
-- refresh_token so existing grants could be sealed on first touch. The backfill
-- has drained (0 live plaintext rows). The plaintext columns and the partial
-- index that tracked unsealed rows are now dead surface — tokens live only in
-- the sealed blob. The Worker read path no longer looks at plaintext.

DROP INDEX IF EXISTS idx_calendar_connections_unsealed;

ALTER TABLE calendar_connections
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;
