-- Knowledge marketplace purchases.
--
-- Installing a PAID knowledge listing now requires a recorded purchase for the
-- buyer's tenant (free listings still install directly). One purchase per
-- tenant+listing unlocks install for that whole workspace. On the default
-- self-hosted config (PAYMENT_PROVIDER=manual) a purchase is recorded
-- immediately; hosted card providers record it after settlement.
CREATE TABLE IF NOT EXISTS knowledge_listing_purchases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES marketplace_knowledge(id) ON DELETE CASCADE,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchased_by  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  provider      VARCHAR(24) NOT NULL DEFAULT 'manual',
  external_ref  VARCHAR(255),
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_listing_purchase_unique
  ON knowledge_listing_purchases (listing_id, tenant_id);
