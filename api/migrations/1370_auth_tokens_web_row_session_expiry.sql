-- 1370 · Web token rows written by the first short-lived-token release keep their row until the session can end.
--
-- A web token's `auth_tokens` row now carries `expires_at` = the end of its SESSION (`sat + sma`), so the
-- expired-credential sweep (expiry + 7 days) never deletes the current row of a device asleep for days: renewal
-- needs that row to continue the session. Rows written by the release before this one carry the 15-minute token
-- `exp` instead, and would be swept a week later while a trusted-device session (30 days) is still renewable.
--
-- The session end is not stored in the database, so those rows get the longest a session can last from its
-- start: the session row's `created_at` + 30 days. Only live rows of an active session whose `expires_at` is
-- within 16 minutes of `issued_at` (the short-token shape) are touched; a 24-hour session's row is kept a little
-- longer than needed, never shorter.
--
-- Data-only, idempotent (GREATEST never moves a row backwards), expand-only.
SET LOCAL lock_timeout = '3s';

UPDATE auth_tokens t
   SET expires_at = GREATEST(t.expires_at, s.created_at + interval '30 days')
  FROM auth_user_sessions s
 WHERE s.id = t.session_id
   AND s.user_id = t.user_id
   AND s.is_active = true
   AND s.revoked_at IS NULL
   AND t.token_type = 'web'
   AND t.revoked_at IS NULL
   AND t.expires_at <= t.issued_at + interval '16 minutes'
   AND t.expires_at > now() - interval '7 days';
