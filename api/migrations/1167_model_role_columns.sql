-- 1167 — Model ROLE columns on the two usage/outcome tables.
--
-- WHAT THIS ADDS. Model routing used to have one axis: the tenant's BYO precedence
-- order, applied identically whether a call was planning, writing code, verifying a
-- diff or doing cheap mechanical work. `role` (plan|code|verify|explore|chat|utility,
-- see api/src/application/llm/modelRoles.ts) is the new axis a call declares so
-- routing can pick a model suited to the work — a `spawn_agent` delegation is the
-- first caller to set one.
--
-- Nullable on BOTH tables: most producers do not resolve a role yet (only a cloud
-- run's top-level turn and its spawn_agent children do), and a row written before
-- this migration genuinely has none — there is no honest default to backfill.
-- `run_model_outcomes.role` lets `routingTable.ts` eventually rank models WITHIN a
-- role once non-'code' roles have accumulated enough outcomes of their own to be
-- worth scoring separately; `llm_usage_log.role` lets spend/latency be reported by
-- role once adoption widens past the cloud engine.

ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS role varchar(16);
ALTER TABLE llm_usage_log      ADD COLUMN IF NOT EXISTS role varchar(16);

COMMENT ON COLUMN run_model_outcomes.role IS
  'Call-purpose role this run resolved as (plan|code|verify|explore|chat|utility) — null for rows scored before migration 1167, and for every top-level run today it is always ''code''.';

COMMENT ON COLUMN llm_usage_log.role IS
  'Call-purpose role this call resolved as, when the producer knew it (migration 1167) — null for most rows until role adoption widens past the cloud engine''s spawn_agent delegations.';
