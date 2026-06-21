-- Migration: per-tenant daily image-generation credit limit (T3 · Gateway & LLM, band 0130–0139).
--
-- Before this, `POST /v1/images/generations` charged a flat ~1000 tokens/image
-- against the SAME `llm_usage_log.total_tokens` the chat daily-token cap sums,
-- so heavy image use could exhaust a tenant's text budget (and vice-versa), and
-- image gen had no cap of its own. This separates the two budgets:
--
--   tenants.image_credits_daily_limit — a per-tenant daily ceiling on returned
--     images (1 credit = 1 image). NULL → plan default (free 10 / pro 1000 /
--     teams 5000, see PlanLimits.imageCreditsDailyLimit); -1 → unlimited;
--     >= 0 → explicit cap.
--
-- The gateway now (a) EXCLUDES image-product rows (`builderforceImage*`) from the
-- chat token-cap sum, and (b) gates image gen against this independent credit
-- cap. Resets at UTC midnight. Resolved via `resolveImageCreditsDailyLimit`.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS image_credits_daily_limit INTEGER;
