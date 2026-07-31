-- 0382 — OpenRouter CONNECTIONS: named, prioritizable model sets served through our gateway.
--
-- WHAT THIS ADDS. Until now a tenant's "bring your own model" surface was one credential per
-- PROVIDER (`tenant_llm_provider_keys`, PK (tenant_id, provider)) and the model each provider
-- contributed was a single hardcoded frontier flagship (modelPool.BYO_FRONTIER_FLAGSHIPS).
-- That shape cannot express the thing operators keep asking for: "route my agents through
-- OpenRouter, on THESE models, in THIS order." OpenRouter is a router, not a provider — its
-- value is the long tail of ids behind one endpoint — so a one-row-per-provider table with an
-- implicit single model is structurally the wrong unit for it.
--
-- A connection is therefore a NAMED MODEL SET (label + 1..N OpenRouter model ids), and a
-- tenant may hold several. "Cheap coders" can sit above a connected Anthropic account while
-- "Frontier" sits below it — one ordering across both tables (see `priority` below).
--
-- KEY IS OPTIONAL, and the two cases bill differently:
--   • key_enc NOT NULL → the tenant's OWN OpenRouter account pays for the tokens. The gateway
--     dispatches those model ids on that key (vendors/openrouter.ts resolves it per-model via
--     VendorEnv.OPENROUTER_MODEL_KEYS), so llm_usage_log.cost_usd_millicents carries no token
--     cost for the row — exactly like every other BYO credential.
--   • key_enc NULL     → the request rides Builderforce's metered OpenRouter key and the row
--     is priced from the catalog as usual.
-- In BOTH cases the turn is routed, failed over and metered by us, so it carries the flat
-- per-request platform surcharge (usageLedger.PREMIUM_REQUEST_SURCHARGE_MILLICENTS, $0.01).
-- That is why 0382 ships alongside the usageLedger change that stops skipping the surcharge on
-- BYO rows: "who pays for the tokens" and "who charges for the routing" are different
-- questions, and conflating them meant a keyed connection would have been routed for free.
--
-- PRIORITY IS SHARED WITH tenant_llm_provider_keys. Both tables' `priority` columns are stamped
-- from ONE ordered list by tenantProviderKeyService.setByoPrecedence, out of a single integer
-- space, so a connection and a provider can interleave. NULL still means "unset → falls back to
-- catalog-tier ordering", identical to 0338's meaning for the provider table.
--
-- `models` is a JSONB array of BARE OpenRouter model ids (e.g. "anthropic/claude-sonnet-5").
-- The gateway prefixes them to `openrouter/<id>` at the routing boundary
-- (openRouterConnectionService.connectionModelRefs) so they can never be mistaken for a direct
-- vendor id — a bare `openai/…` is OpenRouter's namespace, not the direct OpenAI vendor.

CREATE TABLE IF NOT EXISTS tenant_openrouter_connections (
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Operator-chosen name, shown on the Integrations card and in the priority list.
  label              text NOT NULL,
  -- Encrypted OpenRouter API key. NULL = managed (routes on Builderforce's key).
  key_enc            text,
  -- JSONB array of bare OpenRouter model ids selected during registration (1..N).
  models             jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Shared precedence space with tenant_llm_provider_keys.priority. LOWER = tried first.
  priority           integer,
  created_by_user_id text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

-- One connection per NAME per tenant — the label is how an operator refers to it in the
-- priority list, so two "Frontier" rows would make that list unreadable. Case-insensitive
-- so "Frontier" and "frontier" collide rather than silently coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_openrouter_connection_label
  ON tenant_openrouter_connections (tenant_id, lower(label));

-- The read is always "this tenant's connections, most-preferred first" (the ordering the
-- gateway seed and the settings list both consume), so index the sort, not just the filter.
CREATE INDEX IF NOT EXISTS idx_openrouter_connections_tenant_priority
  ON tenant_openrouter_connections (tenant_id, priority NULLS LAST, id);

COMMENT ON TABLE tenant_openrouter_connections IS
  'A tenant''s OpenRouter connections (0382): each a NAMED SET of 1..N OpenRouter model ids, optionally bound to the tenant''s own OpenRouter API key. Routed and metered by the gateway in both cases, so every turn carries the flat per-request platform surcharge; token cost is charged only when key_enc IS NULL. `priority` shares one integer space with tenant_llm_provider_keys.priority so connections and connected providers interleave in a single precedence list.';

COMMENT ON COLUMN tenant_openrouter_connections.key_enc IS
  'Encrypted OpenRouter API key (AES-GCM, per-tenant derived — see integrations/credentialCrypto). NULL = managed: the request rides Builderforce''s OPENROUTER_API_KEY and is priced from the catalog. NOT NULL = the tenant''s own account pays for the tokens (row recorded byo, token cost 0).';

COMMENT ON COLUMN tenant_openrouter_connections.models IS
  'JSONB array of BARE OpenRouter model ids (e.g. "anthropic/claude-sonnet-5"), in the operator''s chosen order. Prefixed to `openrouter/<id>` at the routing boundary so they can never collide with a direct-vendor id.';

COMMENT ON COLUMN tenant_openrouter_connections.priority IS
  'BYO precedence, LOWER = tried first. Shares ONE integer space with tenant_llm_provider_keys.priority (both stamped by setByoPrecedence from a single ordered list). NULL = unset → catalog-tier ordering, same meaning as 0338.';
