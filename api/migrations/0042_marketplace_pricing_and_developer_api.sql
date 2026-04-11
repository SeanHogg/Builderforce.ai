-- Migration 0042: Marketplace pricing, purchases, and developer API keys.
--
-- Ports the previously-orphaned top-level migration 003 into the api/migrations
-- directory so the runner at scripts/migrate.mjs actually applies it.
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pricing_model enum
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE pricing_model AS ENUM ('flat_fee', 'consumption');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Pricing columns on marketplace_skills
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE marketplace_skills
  ADD COLUMN IF NOT EXISTS price_cents   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_model pricing_model NOT NULL DEFAULT 'flat_fee',
  ADD COLUMN IF NOT EXISTS price_unit    VARCHAR(100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. marketplace_purchases — records completed purchases
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id                       SERIAL PRIMARY KEY,
  user_id                  VARCHAR(36)    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_type            artifact_type  NOT NULL,
  artifact_slug            VARCHAR(255)   NOT NULL,
  price_cents              INTEGER        NOT NULL DEFAULT 0,
  pricing_model            pricing_model  NOT NULL DEFAULT 'flat_fee',
  stripe_payment_intent_id VARCHAR(255),
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_user_id ON marketplace_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_artifact ON marketplace_purchases(artifact_type, artifact_slug);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. developer_api_keys — external developer API access
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS developer_api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  key_hash     VARCHAR(128) NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_developer_api_keys_user_id ON developer_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_developer_api_keys_hash ON developer_api_keys(key_hash);
