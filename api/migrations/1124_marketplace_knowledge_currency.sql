-- 1124 · A knowledge listing can only be priced in USD.
--
-- `marketplace_knowledge` had no `currency` column (unlike `catalog_items`,
-- which already carries one), so `startKnowledgeCheckout` hardcoded 'USD' and
-- a non-US seller priced a listing in a currency they do not use. Mirrors
-- `catalog_items.currency` exactly: nullable, ISO 4217, NULL reads as USD.
-- Settlement (the ledger entries a sale credits) stays in usd_cents — this is
-- a pricing/display change, not a multi-currency ledger.
ALTER TABLE marketplace_knowledge ADD COLUMN IF NOT EXISTS currency varchar(8);

COMMENT ON COLUMN marketplace_knowledge.currency IS
  'ISO 4217 code the price_cents is denominated in. NULL reads as USD. '
  'Chosen by the seller on the publish surface (POST /documents/:id/list).';
