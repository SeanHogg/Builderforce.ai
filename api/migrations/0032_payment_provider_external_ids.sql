-- Migration: add payment provider external IDs to tenants
-- Allows any payment provider (Stripe, Helcim, etc.) to link its customer
-- and subscription records back to a Builderforce tenant.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS external_customer_id      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_subscription_id  VARCHAR(255);

-- Index for webhook lookup: provider sends externalCustomerId, we need to find the tenant
CREATE INDEX IF NOT EXISTS idx_tenants_external_customer_id
  ON tenants (external_customer_id)
  WHERE external_customer_id IS NOT NULL;
