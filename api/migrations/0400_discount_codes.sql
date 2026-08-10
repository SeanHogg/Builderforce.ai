CREATE TABLE IF NOT EXISTS discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL UNIQUE,
  percent_off integer NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  applicable_plan varchar(16) NOT NULL DEFAULT 'pro' CHECK (applicable_plan IN ('pro', 'teams')),
  billing_cycle varchar(16) NOT NULL DEFAULT 'yearly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  duration_years integer NOT NULL DEFAULT 1 CHECK (duration_years BETWEEN 1 AND 20),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discount_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checkout_session_id varchar(255),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  CONSTRAINT uq_discount_redemption_tenant_code UNIQUE (tenant_id, discount_code_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_discount_redemption_checkout
  ON discount_redemptions (checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discount_redemptions_tenant
  ON discount_redemptions (tenant_id, applied_at DESC);

-- First signup offer: 50% off annual Individual/Pro for the first year.
INSERT INTO discount_codes (code, percent_off, applicable_plan, billing_cycle, duration_years)
VALUES ('ANNUAL50', 50, 'pro', 'yearly', 1)
ON CONFLICT (code) DO NOTHING;
