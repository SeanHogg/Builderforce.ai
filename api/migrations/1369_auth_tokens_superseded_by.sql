-- 1369 · Which token replaced this one through a web renewal (`POST /api/auth/web/renew`).
--
-- Web access tokens are short-lived and renewed by rotation: each renewal issues a new jti under the same session
-- and revokes the presented one. `auth_tokens.superseded_by` records the jti that replaced a token, which is how a
-- renewal tells "this token was rotated" (a repeat within a short window returns the same successor; later it ends
-- the whole session) from every other revocation (sign-out, admin revoke), which leaves it NULL.
--
-- Expand only: one nullable column, no default, no backfill. The old Worker's INSERT/UPDATE of auth_tokens does not
-- name it, so it is unaffected while the deploy completes. Idempotent / re-runnable.
SET LOCAL lock_timeout = '3s';

ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS superseded_by varchar(64);
