-- 1277 · The run's pipeline route on the usage ledger (cost-lever parity · WS-R).
--
-- Two nullable columns on `llm_usage_log`, written by the one writer
-- (`recordUsageRow`) from the metadata the run loop already sends with every call.
-- Mirror: transactional-migrations/0024 (the operational endpoint holds this relation
-- in production; this track holds it locally and in tests).
--
--   pipeline_route  'full' (plan → code → verify) or 'quick' (one coding pass) — the
--                   route `@builderforce/pipeline-route` decided once for the call's run.
--                   NULL when the run was not routed (a host that sends no pipeline
--                   settings, a sub-agent, every row written before this).
--   route_score     the router's score for that run, P(full pipeline needed) in [0, 1].
--
-- Expand only: nullable, no default, no backfill — no existing reader's sums move. The
-- day fold keeps `pipeline_route` as a dimension and averages `route_score`.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS pipeline_route VARCHAR(8);
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS route_score REAL;
