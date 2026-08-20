-- Migration 0934: real chat_id / chat_mode columns on llm_usage_log.
--
-- Per-chat and per-mode spend was reconstructed by scanning the free-form
-- `metadata` JSON (`metadata::jsonb ->> 'chatId'`). That could not use an index,
-- silently dropped every row whose metadata was absent or not an object — so the
-- figures were a floor, not a total — and, because `metadata` is JSONB while the
-- Drizzle schema declared it `text`, the guard expression `metadata ~ '^\s*\{'`
-- applied a TEXT-only operator to a jsonb column and threw
-- `operator does not exist: jsonb ~ unknown` at runtime. The rollup returned
-- nothing at all.
--
-- Attribution that the product reports on belongs in columns. `chat_id` and
-- `chat_mode` are written by the usage ledger alongside metadata (metadata keeps
-- carrying them for the SDK's billing trace-back contract) and backfilled here
-- for every historical row that recorded one.
--
-- TWO TRACKS, DELIBERATELY. `resolveUsageDatabase` sends the row to
-- NEON_TRANSACTIONAL_DATABASE_URL when that secret is bound and falls back to
-- this database when it is not, so both copies of the table are live and both
-- need the columns. The operational twin is
-- transactional-migrations/0005_llm_usage_chat_attribution.sql, which also has
-- to ALTER `metadata` to jsonb -- it was created TEXT there and JSONB here.

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS chat_id   INTEGER,
  ADD COLUMN IF NOT EXISTS chat_mode VARCHAR(16);

-- Backfill from the metadata JSON. `jsonb_typeof(...) = 'object'` is the guard the
-- old query wrote as a regex against text; on a jsonb column it is both correct
-- and index-friendly. A non-numeric chatId is left NULL rather than coerced.
UPDATE llm_usage_log
   SET chat_id = (metadata ->> 'chatId')::integer
 WHERE chat_id IS NULL
   AND metadata IS NOT NULL
   AND jsonb_typeof(metadata) = 'object'
   AND metadata ->> 'chatId' ~ '^[0-9]+$';

UPDATE llm_usage_log
   SET chat_mode = left(metadata ->> 'mode', 16)
 WHERE chat_mode IS NULL
   AND metadata IS NOT NULL
   AND jsonb_typeof(metadata) = 'object'
   AND metadata ->> 'mode' IS NOT NULL;

-- Partial: chat-attributed rows are a small slice of total usage.
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_chat_id
  ON llm_usage_log (tenant_id, chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;
