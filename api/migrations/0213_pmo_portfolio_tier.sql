-- 0213_pmo_portfolio_tier.sql
--
-- The PMO anchor: an Initiative / Portfolio / OKR tier ABOVE the existing project
-- tier, so the cost + delivery + DORA + outcome collectors we already write on
-- every run roll up to the cadence the PMO and C-suite live in (initiative → ship
-- → measured). No new collectors — this is the rollup object the substrate was
-- missing.
--
--   portfolio ──< initiative ──< project (existing) ──< task (existing)
--   portfolio/initiative ──< objective ──< key_result   (OKR)
--
-- Cost rolls up via the link path: llm_usage_log.project_id (0103) → projects
-- (now .initiative_id) → initiatives.portfolio_id. DORA via deployment_events
-- .project_id, outcomes via run_model_outcomes.project_id, delivery via tasks.
--
-- All tenant + segment scoped to match every other surface (segment NOT NULL is
-- enforced by the 0056 trigger; nullable here in DDL so single-mode writes need
-- no segment). uuid PKs match the planning/tracker tables (roadmap_items,
-- product_releases, feature_flags) so the generic segment tracker CRUD drives
-- their management with no bespoke router.
--
-- Idempotent / re-runnable: CREATE TABLE / ADD COLUMN / CREATE INDEX IF NOT EXISTS.

-- ── Portfolios (top tier) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | archived
  owner_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  target_date   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolios_scope ON portfolios(tenant_id, segment_id);

-- ── Initiatives (mid tier; belong to a portfolio, optionally) ────────────────
CREATE TABLE IF NOT EXISTS initiatives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  portfolio_id  UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'proposed', -- proposed | active | completed | archived
  owner_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  target_date   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_initiatives_scope ON initiatives(tenant_id, segment_id, portfolio_id);

-- ── Project → Initiative link (the rollup join) ──────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL;
-- Rollup read assist: the set of projects under an initiative.
CREATE INDEX IF NOT EXISTS idx_projects_initiative
  ON projects(initiative_id) WHERE initiative_id IS NOT NULL;

-- ── Objectives (OKR; attach to a portfolio and/or initiative) ────────────────
CREATE TABLE IF NOT EXISTS objectives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  portfolio_id  UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  period        VARCHAR(20),                              -- e.g. '2026-Q2'
  status        VARCHAR(20) NOT NULL DEFAULT 'active',    -- active | achieved | missed | archived
  owner_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_objectives_scope ON objectives(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_objectives_portfolio ON objectives(portfolio_id) WHERE portfolio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objectives_initiative ON objectives(initiative_id) WHERE initiative_id IS NOT NULL;

-- ── Key results (measurable; belong to an objective) ─────────────────────────
CREATE TABLE IF NOT EXISTS key_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  objective_id  UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  metric_type   VARCHAR(20) NOT NULL DEFAULT 'number',    -- number | percent | currency | boolean
  start_value   REAL NOT NULL DEFAULT 0,
  target_value  REAL NOT NULL DEFAULT 100,
  current_value REAL NOT NULL DEFAULT 0,
  unit          VARCHAR(20),
  status        VARCHAR(20) NOT NULL DEFAULT 'on_track',  -- on_track | at_risk | off_track | done
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_results_objective ON key_results(objective_id);
CREATE INDEX IF NOT EXISTS idx_key_results_scope ON key_results(tenant_id, segment_id);
