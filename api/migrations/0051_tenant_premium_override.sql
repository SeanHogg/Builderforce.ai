-- Per-tenant premium override. When TRUE, the LLM proxy routes the tenant
-- through the premium model pool (top PREMIUM-tier models) with the extended
-- per-vendor timeout, regardless of the tenant's plan/billingStatus. Mirrors
-- the existing tokenDailyLimitOverride pattern (superadmin grant for beta /
-- comped access without flipping the billing plan).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS premium_override BOOLEAN NOT NULL DEFAULT FALSE;
