-- Migration: per-user locale — the key transactional email is localized on.
--
-- The frontend has served EN/ZH/ES/FR/DE via next-intl for a while (NEXT_LOCALE
-- cookie, `frontend/src/i18n`), but every email template was hardcoded English
-- because the server had nowhere to read a user's language from. This column is
-- that missing key: captured at signup from the request (NEXT_LOCALE cookie, then
-- Accept-Language), and editable from /settings?sub=email.
--
-- Deliberately NULLABLE with no default and no backfill:
--   * NULL means "never captured" — the shared resolver
--     (application/email/emailLocaleResolver.ts) then falls back to the request's
--     own locale hints and finally 'en'. A DEFAULT 'en' would be a LIE: it would
--     make an unknown locale indistinguishable from a deliberate English choice
--     and permanently pin every pre-existing account to English even when the
--     request clearly says otherwise.
--   * Every existing row therefore keeps exactly today's behaviour (English),
--     which is why this needs no backfill and cannot break a live send.
--
-- varchar(5) fits a BCP-47 base tag plus a region ('en', 'pt-BR'). The resolver
-- narrows whatever is stored to the five supported locales at read time, so a
-- wider tag arriving from a future signup path degrades to its base language
-- rather than erroring.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale varchar(5);
