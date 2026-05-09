-- Migration 0046: Persist the SDK's opaque `useCase` slug on llm_usage_log.
--
-- The SDK forwards `useCase` as a free-form telemetry tag (e.g. `studio_script`,
-- `recruiter_outreach`, `auto_apply.submit_form`). The gateway never reads it
-- for routing — it's stored verbatim on the usage row and echoed back so
-- callers can confirm round-trip and run per-feature spend queries against
-- the same row that carries token counts + metadata + idempotency_key.
--
-- Idempotent: safe to re-run.

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS use_case VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_use_case
  ON llm_usage_log (tenant_id, use_case)
  WHERE use_case IS NOT NULL;
