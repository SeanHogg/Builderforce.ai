-- 0121_project_sites.sql
-- Subdomain hosting for IDE (Designer) projects: a published app served at
-- {subdomain}.apps.builderforce.ai.
--
-- One site per project (project_id UNIQUE) — re-publishing the same project
-- overwrites its assets and bumps version_token (the cache-bust token the
-- subdomain→site lookup is keyed by; see infrastructure/cache/readThroughCache).
--
-- mode:
--   'static'    — built assets (dist/) live in R2 under r2_prefix, served by the
--                 public sites Worker. Default; covers Vite/React SPAs.
--   'container' — long-lived V2 Cloudflare Container serves the app (SSR/APIs).
--                 Reserved here; container web-serving is a later phase.
--
-- subdomain is a DNS label (max 63 chars, lowercase a-z0-9 and hyphen). A
-- reserved-label blocklist is enforced in the route, not the schema, so it can
-- evolve without a migration.
--
-- No FK on subdomain uniqueness beyond the table — global across tenants because
-- the namespace is shared (apps.builderforce.ai).
--
-- Idempotent / re-runnable: table + indexes guarded.

CREATE TABLE IF NOT EXISTS project_sites (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- globally-unique DNS label under apps.builderforce.ai
  subdomain      VARCHAR(63) NOT NULL UNIQUE,
  mode           VARCHAR(16) NOT NULL DEFAULT 'static',   -- 'static' | 'container'
  status         VARCHAR(16) NOT NULL DEFAULT 'active',    -- 'active' | 'building' | 'disabled'
  -- R2 prefix the built assets live under (e.g. 'sites/myapp/')
  r2_prefix      TEXT NOT NULL,
  -- bumped on every publish; folded into the subdomain→site cache key so a
  -- redeploy is visible immediately instead of waiting out the KV TTL
  version_token  VARCHAR(32) NOT NULL,
  -- entry document served for directory / SPA-fallback requests
  index_document VARCHAR(128) NOT NULL DEFAULT 'index.html',
  -- optional vanity domain (CNAME'd by the tenant); null until configured
  custom_domain  VARCHAR(255),
  -- denormalized count + bytes of the last publish (UI / quota; cheap to keep)
  asset_count    INTEGER NOT NULL DEFAULT 0,
  total_bytes    BIGINT  NOT NULL DEFAULT 0,
  published_at   TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_sites_tenant ON project_sites(tenant_id);
-- subdomain lookup is the hot path (every asset request resolves it); UNIQUE
-- already creates an index, so no extra index needed for it.
CREATE INDEX IF NOT EXISTS idx_project_sites_custom_domain ON project_sites(custom_domain) WHERE custom_domain IS NOT NULL;
