-- Give the VALIDATED card its own columns, separate from the SUBSCRIPTION card.
--
-- `billing_payment_brand` / `billing_payment_last4` were written by two unrelated
-- flows: the card-validation webhook (the $0 SetupIntent card that unlocks premium
-- models) and TenantService.handleWebhookEvent (the card that actually bills the
-- subscription). A tenant whose two cards differ saw whichever wrote last — so the
-- "Card on file" panel could display one card while `external_payment_method_id`
-- pointed at another, and a Remove would name a card it wasn't going to detach.
--
-- After this, each purpose owns its own record:
--   card_brand / card_last4 / external_payment_method_id → the VALIDATED card
--   billing_payment_brand / billing_payment_last4        → the SUBSCRIPTION card
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_brand VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(4);

-- Best-effort backfill: for a tenant that HAS a validated card, the existing
-- billing_payment_* values are the closest thing we have to it. Restricted to
-- validated rows so a purely-subscription tenant's card is never mislabelled as a
-- validated one. Tenants whose two cards differed keep whatever was last written
-- until their next validation overwrites it with the real card — unavoidable, since
-- the distinction was never recorded.
UPDATE tenants
   SET card_brand = billing_payment_brand,
       card_last4 = billing_payment_last4
 WHERE card_validated_at IS NOT NULL
   AND card_brand IS NULL
   AND billing_payment_last4 IS NOT NULL;
