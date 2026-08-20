-- 0952 — a daily ceiling on PREMIUM spend, and the column that makes it measurable.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- The premium tier lets a paid tenant pin ANY paid OpenRouter model — including
-- Opus-class ids at ~$75/M output — billed at vendor cost plus a flat per-request
-- surcharge. Entitlement was the only gate: a paid plan with a validated card, and
-- from there nothing anywhere bounded the spend. `resolve_paid_overflow_cap` returns
-- -1 (unlimited) for pro/teams, and a premium model is deliberately NOT in
-- PAID_OVERFLOW_MODELS, so premium turns were not even COUNTED by the one daily cap
-- that exists. A runaway agent pinned to an expensive model could bill without bound
-- inside a single UTC day, and the first anyone would know is the invoice.
--
-- ── TWO COLUMNS, BOTH NEEDED ────────────────────────────────────────────────
-- `tenants.premium_daily_cap` is the ceiling — the exact sibling of
-- `paid_overflow_daily_cap` (0130), same units (millicents, 1/100000 USD) and same
-- three-state convention, so an operator learns one rule rather than two:
--     NULL  → plan default
--     -1    → unlimited (the deliberate opt-out)
--     >= 0  → this value
--
-- `llm_usage_log.premium` is what makes the ceiling enforceable. Premium-ness was
-- only ever recorded as a `premiumSurchargeMillicents` key inside the `metadata`
-- jsonb, which is neither indexable nor summable without a full scan — a cap that
-- cannot be measured cheaply is a cap that gets disabled the first time it costs
-- latency. A real boolean column, mirroring `paid_overflow` (0130), makes the
-- day's premium spend one indexed SUM.
--
-- TWO TRACKS, DELIBERATELY: the operational twin is
-- transactional-migrations/0007_premium_daily_cap.sql. `llm_usage_log` is written
-- through `resolveUsageDatabase`, which targets the operational database whenever
-- NEON_TRANSACTIONAL_DATABASE_URL is bound and falls back to the primary when it is
-- not — so a column added to only one track is absent exactly where the rows land.
-- `tenants` lives ONLY on the primary track and is therefore not duplicated there.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS premium_daily_cap INTEGER;

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial, matching the `paid_overflow` index it mirrors: premium rows are a small
-- fraction of the table, and the only query is "this tenant's premium spend today".
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_premium
  ON llm_usage_log(tenant_id, created_at) WHERE premium = TRUE;
