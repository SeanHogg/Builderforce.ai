-- Widen avatar_url columns from varchar(500) to text.
--
-- Root cause of the "value too long for type character varying(500)" JSON error
-- on Google (and other OAuth) signup: the provider `picture` URL is written to
-- users.avatar_url, but Google's signed lh3.googleusercontent.com URLs (with
-- =s…-c sizing + query params) routinely exceed 500 chars, so the users INSERT
-- in the OAuth callback failed before the account was ever created.
--
-- avatar_url is an unbounded external URL everywhere it appears (OAuth provider
-- pictures, GitHub/Jira contributor avatars, R2 upload URLs with query params,
-- mirrored freelancer profile avatars). oauth_accounts.avatar_url was already
-- TEXT; this aligns the remaining siblings so the whole class of overflow is
-- closed, not just the one reported path.
--
-- varchar(n) -> text is an in-place metadata change in Postgres (no table
-- rewrite, no data loss), so this is safe on live tables.

ALTER TABLE users                  ALTER COLUMN avatar_url TYPE text;
ALTER TABLE contributors           ALTER COLUMN avatar_url TYPE text;
ALTER TABLE contributor_identities ALTER COLUMN avatar_url TYPE text;
ALTER TABLE teams                  ALTER COLUMN avatar_url TYPE text;
