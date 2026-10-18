-- 1245 · `brain_chats.original_request` — the user's FIRST prompt, kept (ticket #5687).
--
-- A Brain chat records its auto-generated TITLE, which is a ~60-char derivation of the
-- first prompt (`deriveChatTitle`: first non-empty line, whitespace collapsed, cut on a
-- word boundary). The prompt itself was never stored, so when a chat is linked to a
-- ticket the origin text is lost — the rail can name the ticket but not say what it was
-- asked for.
--
-- The column is NULLABLE `text`, not `varchar`: unlike the title there is no 500-char
-- display budget — the point is to preserve the request as asked — and NULL is the honest
-- state for every chat created before this migration (and for a seeded/imported chat
-- whose first turn was never captured), so absence is a valid value rather than an error.
-- Written ONCE by the first-turn seam (`useChatCreation.onFirstUserTurn`); read-only after.
--
-- Idempotent, and safe on a database where the column is already present.

ALTER TABLE brain_chats ADD COLUMN IF NOT EXISTS original_request TEXT;