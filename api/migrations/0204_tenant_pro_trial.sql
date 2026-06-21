-- Migration 0204: 14-day Pro trial on tenant creation.
--
-- The public marketing claim ("14-day Pro trial") was previously fiction —
-- register created only a users row and tenant creation started every tenant on
-- the Free plan with billing_status='none'. This makes the trial real:
--
--   * tenant_billing_status enum gains 'trialing' — the status a tenant carries
--     while inside its introductory trial window.
--   * tenants.trial_ends_at — when the trial ends (creation + 14 days). While
--     billing_status='trialing' AND trial_ends_at > now() the tenant is entitled
--     to Pro limits (see domain/tenant/effectivePlan.ts: resolveEffectivePlan).
--     Once it passes, the effective plan falls back to Free automatically — no
--     sweeper needed (the resolver is time-based).
--
-- New tenants are stamped plan='pro', billing_status='trialing',
-- trial_ends_at=now()+14d by Tenant.create(); the paid 'active' path is unchanged.
-- Existing tenants are left as-is (trial_ends_at NULL → treated as not trialing).

-- Add the 'trialing' value to the billing-status enum (idempotent).
ALTER TYPE tenant_billing_status ADD VALUE IF NOT EXISTS 'trialing';

-- Trial expiry timestamp (NULL = never trialing / pre-0204 tenant).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
