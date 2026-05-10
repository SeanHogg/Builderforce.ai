-- Migration 0048: Per-key audit trail on llm_usage_log.
--
-- Without this column, the gateway can tell you the *tenant* that made a call
-- but not which `bfk_*` key was used. That makes it impossible for owners
-- (and superadmins) to answer "what did this specific key do?" — needed
-- for incident response (a leaked key), per-key spend dashboards, and
-- pre-revocation impact assessment.
--
-- Nullable: pre-existing rows + non-bfk_* paths (clk_*, web JWT) leave it null.
-- ON DELETE SET NULL: revoking a key shouldn't cascade-delete its history.
--
-- Idempotent: safe to re-run.

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS tenant_api_key_id UUID REFERENCES tenant_api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_tenant_api_key_id
  ON llm_usage_log (tenant_api_key_id, created_at DESC)
  WHERE tenant_api_key_id IS NOT NULL;
