-- Referral attribution, commission policy, revenue goals, and event preferences.
CREATE TABLE IF NOT EXISTS sales_commission_rules (
  rule_key varchar(40) PRIMARY KEY,
  plan varchar(20) NOT NULL,
  billing_cycle varchar(20) NOT NULL,
  referral_bps integer NOT NULL DEFAULT 0 CHECK (referral_bps BETWEEN 0 AND 10000),
  sales_bps integer NOT NULL DEFAULT 0 CHECK (sales_bps BETWEEN 0 AND 10000),
  updated_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sales_commission_rules(rule_key, plan, billing_cycle, referral_bps, sales_bps) VALUES
  ('pro:monthly', 'pro', 'monthly', 0, 0), ('pro:yearly', 'pro', 'yearly', 0, 0),
  ('teams:monthly', 'teams', 'monthly', 0, 0), ('teams:yearly', 'teams', 'yearly', 0, 0)
ON CONFLICT (rule_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_associate_settings (
  owner_user_id varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referral_code varchar(32) NOT NULL UNIQUE,
  sales_code varchar(32) NOT NULL UNIQUE,
  revenue_goal_cents bigint NOT NULL DEFAULT 0,
  notify_on_signup boolean NOT NULL DEFAULT true,
  notify_on_conversion boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id varchar(36) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  attribution_type varchar(16) NOT NULL DEFAULT 'referral' CHECK (attribution_type IN ('referral', 'sales')),
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  signup_notified_at timestamptz,
  converted_at timestamptz,
  tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL,
  plan varchar(20), billing_cycle varchar(20),
  revenue_cents bigint, commission_bps integer, commission_cents bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_associate ON sales_referrals(associate_user_id, signed_up_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_conversion ON sales_referrals(referred_user_id, converted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_referrals_tenant_attribution ON sales_referrals(tenant_id) WHERE tenant_id IS NOT NULL;
