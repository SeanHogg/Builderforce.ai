-- 0359_member_spend_caps.sql
-- Owner-configurable per-seat monthly AI spend caps for Teams.
--
-- Non-BYO usage is already metered at the OpenRouter rate in
-- llm_usage_log.cost_usd_millicents (BYO rows are forced to 0). These columns let
-- the account OWNER put a dollar ceiling on each seat's month-to-date spend and be
-- notified as a seat approaches it. Enforced at the gateway spend gate
-- (application/consumption/memberSpend.ts) for Teams-plan tenants only
-- (PlanLimits.seatCostControls). Superadmin operators are never capped.

-- Team-wide DEFAULT per-seat monthly spend cap (millicents, 1/100000 USD).
--   NULL → no default (seats are uncapped unless individually set)
--   >= 0 → the default cap applied to every seat with no explicit override
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS member_default_spend_cap_millicents BIGINT;

-- Per-seat monthly spend cap + notification-dedupe state.
--   monthly_spend_cap_millicents:
--     NULL → inherit the tenant default
--     -1   → unlimited (override a team default for this seat)
--     >= 0 → explicit cap for this seat (0 = no paid spend allowed)
--   spend_notify_period: 'YYYY-MM' the notify level below applies to (resets monthly)
--   spend_notify_level:  highest % threshold already notified this period (0/50/80/100)
ALTER TABLE tenant_members
  ADD COLUMN IF NOT EXISTS monthly_spend_cap_millicents BIGINT,
  ADD COLUMN IF NOT EXISTS spend_notify_period VARCHAR(7),
  ADD COLUMN IF NOT EXISTS spend_notify_level SMALLINT NOT NULL DEFAULT 0;
