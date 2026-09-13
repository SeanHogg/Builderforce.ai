-- 1167 — `llm_usage_log.role`: what kind of call spent the tokens.
--
-- Model routing used to have one axis: the tenant's BYO precedence order, applied
-- identically whether a call was planning, writing code, verifying a diff or doing
-- cheap mechanical work. `role` (plan|code|verify|explore|chat|utility — see
-- api/src/application/llm/modelRoles.ts) is the axis a call now declares so routing
-- can pick a model suited to the work: the VS Code agent plans on the tenant's chosen
-- order and hands the code to the strongest connected model; a cloud `spawn_agent`
-- delegation names its own role.
--
-- Recording it per usage row is what makes "what does planning cost versus coding"
-- and "which model wrote the code" answerable. Nullable: callers that send no role
-- (SDK traffic, older clients) and every row written before this migration have none,
-- and there is no honest default to backfill.
--
-- The operational database carries its own copy of this table — see
-- transactional-migrations/0011_llm_usage_log_role.sql.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS role varchar(16);

COMMENT ON COLUMN llm_usage_log.role IS
  'Call-purpose role this call resolved as (plan|code|verify|explore|chat|utility), when the producer declared one (migration 1167). Null for callers that send none.';
