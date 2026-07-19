-- Explicit card-validation flow for PREMIUM (any-paid-OpenRouter) model selection.
--
-- A tenant may select any paid OpenRouter model (billed at OpenRouter cost + a flat
-- 1¢/request) only with a PAID plan AND a card that has been through an explicit
-- validation flow (Stripe SetupIntent / $0 auth). `card_validated_at` is stamped when
-- the provider confirms; `card_validation_status` tracks the flow so the UI can show
-- pending / failed states.
--
--   card_validation_status:
--     'none'      → never started
--     'pending'   → SetupIntent created, awaiting provider confirmation
--     'validated' → provider confirmed a usable card (card_validated_at set)
--     'failed'    → provider reported the card could not be validated

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS card_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_validation_status varchar(16) NOT NULL DEFAULT 'none';
