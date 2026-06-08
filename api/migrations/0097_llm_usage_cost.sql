-- 0097_llm_usage_cost.sql
-- Persist an authoritative per-call cost on the usage ledger.
--
-- Before this, the only USD figure was derived at READ time by multiplying
-- tokens by catalog prices in the dashboard — a moving estimate that drifted as
-- catalog prices changed and ignored the cache-read/creation discount split that
-- llm_usage_log already stores. We now stamp the cost at WRITE time from the
-- resolved model's price (incl. cache tiers), so the dashboard/billing just sums
-- a recorded column instead of re-pricing history.
--
-- Stored as millicents (1/100000 USD) to avoid floats, matching telemetry_spans
-- (estimated_cost_usd_millicents).

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS cost_usd_millicents INTEGER NOT NULL DEFAULT 0;
