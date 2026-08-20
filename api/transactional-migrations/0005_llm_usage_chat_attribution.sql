-- 0005 — `chat_id` / `chat_mode` on the OPERATIONAL copy of `llm_usage_log`,
-- and the `metadata` type correction that has to land with them.
--
-- ── WHY THIS EXISTS ALONGSIDE api/migrations/0934 ───────────────────────────
-- `llm_usage_log` is written by `resolveUsageDatabase`, which sends the row to
-- NEON_TRANSACTIONAL_DATABASE_URL when that secret is bound and FALLS BACK to
-- the primary database when it is not. Both are real deployments, so both
-- tracks own a copy of this table and a column added to only one of them is
-- absent exactly where the row actually lands. 0934 does the primary track;
-- this does the operational one. The two files are deliberately not shared:
-- they start from different DDL, which is the whole reason this one has an
-- ALTER TYPE and 0934 does not.
--
-- ── THE TYPE CORRECTION ─────────────────────────────────────────────────────
-- `metadata` was declared JSONB on the primary track (0045) and TEXT here
-- (0001), and the Drizzle schema — which is single, because the application is
-- single — could only match one of them. It now declares `jsonb()`, and the
-- usage ledger passes the OBJECT rather than a `JSON.stringify` of it, so this
-- column has to become jsonb or every operational insert would write the
-- string "[object Object]".
--
-- The cast is written to be total rather than optimistic. Every historical row
-- was written with `JSON.stringify`, so `{…}` / `[…]` parse — but a row that
-- somehow holds a bare string is wrapped by `to_jsonb` instead of failing the
-- migration, because losing the audit value is worse than storing it as a JSON
-- string and an ALTER that aborts leaves the deployment on a schema the code
-- no longer matches.

ALTER TABLE llm_usage_log
  ALTER COLUMN metadata TYPE jsonb
  USING (
    CASE
      WHEN metadata IS NULL           THEN NULL
      WHEN btrim(metadata) = ''       THEN NULL
      WHEN btrim(metadata) LIKE '{%'  THEN metadata::jsonb
      WHEN btrim(metadata) LIKE '[%'  THEN metadata::jsonb
      ELSE to_jsonb(metadata)
    END
  );

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS chat_id   integer,
  ADD COLUMN IF NOT EXISTS chat_mode varchar(16);

-- Backfill from the metadata JSON, which is where this attribution lived before
-- it was a column. `jsonb_typeof(...) = 'object'` is the guard the old rollup
-- wrote as a regex against text — on a jsonb column it is both correct and
-- index-friendly. A non-numeric chatId is left NULL rather than coerced.
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
CREATE INDEX IF NOT EXISTS idx_tx_llm_usage_log_chat_id
  ON llm_usage_log (tenant_id, chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;
