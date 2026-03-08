-- Tenant subscription model (free/pro) + billing metadata
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan VARCHAR(16) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(16),
  ADD COLUMN IF NOT EXISTS billing_status VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_payment_brand VARCHAR(50),
  ADD COLUMN IF NOT EXISTS billing_payment_last4 VARCHAR(4),
  ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMP;

-- Normalize legacy rows that may not have defaults persisted
UPDATE tenants
SET plan = COALESCE(plan, 'free'),
    billing_status = COALESCE(billing_status, 'none')
WHERE plan IS NULL OR billing_status IS NULL;

-- LLM usage should be attributable by tenant/user and product line (free vs pro)
ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS llm_product VARCHAR(32) NOT NULL DEFAULT 'coderClawLLM';

CREATE INDEX IF NOT EXISTS idx_llm_usage_tenant_id   ON llm_usage_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_id     ON llm_usage_log (user_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_llm_product ON llm_usage_log (llm_product);
