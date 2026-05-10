-- Migration: superadmin override for the per-tenant daily token budget.
-- token_daily_limit_override semantics:
--   NULL  → no override; the plan-level default applies.
--   -1    → unlimited (gate skipped entirely).
--   >= 0  → use this value instead of the plan default.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS token_daily_limit_override INTEGER;
