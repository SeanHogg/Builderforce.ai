-- 1165 — Per-provider MODEL SELECTION for a connected BYO account.
--
-- WHAT THIS ADDS. A connected provider (`tenant_llm_provider_keys`, one row per provider)
-- contributed exactly ONE hardcoded model to routing (modelPool.BYO_FRONTIER_FLAGSHIPS) plus a
-- handful of static catalog ids in the picker. A provider whose single key fronts a whole model
-- marketplace — a Qwen Cloud key reaches Qwen, DeepSeek, GLM and Kimi models — could not be told
-- which of those to use. This table is that choice: an ordered list of the provider's model ids,
-- position 0 = the model the account leads with, the rest its failover in order.
--
-- A CHILD of the credential row, keyed (tenant_id, provider) with ON DELETE CASCADE:
--   • a key ROTATION upserts the parent in place (same primary key), so the choice survives it;
--   • a DISCONNECT deletes the parent, so no orphaned choice can steer a later reconnect.
-- One row per selected model rather than a JSONB array: the order is a column, a model can be
-- chosen once per provider (primary key), and nothing about the credential is repeated here.
--
-- `model_id` is the provider's BARE id (e.g. "deepseek-v4-flash"). Routing prefixes it to the
-- provider's tenant-keyed route (`direct/qwen/<id>`) at the boundary (byoModelRouting), so a
-- stored id can never be mistaken for an operator-funded route.

CREATE TABLE IF NOT EXISTS tenant_llm_provider_models (
  tenant_id  integer   NOT NULL,
  provider   text      NOT NULL,
  model_id   text      NOT NULL,
  -- 0-based order within the provider; 0 leads.
  position   integer   NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider, model_id),
  FOREIGN KEY (tenant_id, provider)
    REFERENCES tenant_llm_provider_keys (tenant_id, provider) ON DELETE CASCADE
);

COMMENT ON TABLE tenant_llm_provider_models IS
  'Per-provider model selection (1165): the ordered model ids a connected BYO provider account routes to — position 0 leads, the rest are failover. Child of tenant_llm_provider_keys: survives a key rotation (parent upserted in place), removed with the credential on disconnect. Empty for a provider = its default flagship.';

COMMENT ON COLUMN tenant_llm_provider_models.model_id IS
  'The provider''s BARE model id (e.g. "deepseek-v4-flash"). Prefixed to the tenant-keyed route (direct/<vendor>/<id>) at the routing boundary.';
