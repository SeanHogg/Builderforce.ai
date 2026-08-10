-- Preserve which connected provider credential funded each BYO usage row so
-- consumption can be reported per integration independently of model choice.
ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS byo_provider VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_llm_usage_tenant_byo_provider_created
  ON llm_usage_log (tenant_id, byo_provider, created_at DESC)
  WHERE byo_provider IS NOT NULL;
