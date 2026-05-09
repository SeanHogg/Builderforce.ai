-- Migration 0045: Add metadata + idempotency_key columns to llm_usage_log.
--
-- The SDK forwards a `metadata` object (e.g. { toolRunId, sessionId, userId })
-- on every chat request — used by tenant apps for billing trace-back from the
-- SA dashboard to the originating tool_run row. Persisting it on the same row
-- as token counts means a single join, no cross-reference by request_id.
--
-- The `idempotency_key` column lets the gateway dedupe replays from the
-- SDK's `Idempotency-Key` header within a TTL (planned).
--
-- Idempotent: safe to re-run.

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS metadata        JSONB,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- Partial index: usage rows with metadata are far rarer than total rows.
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_metadata
  ON llm_usage_log USING GIN (metadata)
  WHERE metadata IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_idempotency_key
  ON llm_usage_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
