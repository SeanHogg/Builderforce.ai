-- Migration: Product Management net-new features (doc 02). All (tenant_id,
-- segment_id)-scoped with the 0056 default-segment trigger. These back the
-- Product embed surfaces (mvp, validation, roadmap, release-planning, changelog,
-- feature-flags, business-value, feature-roi) via the generic tracker factory.

CREATE TABLE IF NOT EXISTS mvp_scenarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  pricing_model       VARCHAR(40),
  target_revenue      REAL,
  timeline_constraint INTEGER,
  budget_constraint   REAL,
  team_size           INTEGER,
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_mvp_scenarios_segment ON mvp_scenarios;
CREATE TRIGGER trg_mvp_scenarios_segment BEFORE INSERT ON mvp_scenarios FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_mvp_scenarios_segment ON mvp_scenarios(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS validation_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  hypothesis      TEXT NOT NULL,
  validation_type VARCHAR(20),
  method          VARCHAR(255),
  result          VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  metrics         TEXT,
  learnings       TEXT,
  next_steps      TEXT,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_validation_results_segment ON validation_results;
CREATE TRIGGER trg_validation_results_segment BEFORE INSERT ON validation_results FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_validation_results_segment ON validation_results(tenant_id, segment_id, result);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  horizon     VARCHAR(10) NOT NULL DEFAULT 'now',          -- now|next|later
  status      VARCHAR(20) NOT NULL DEFAULT 'planned',
  theme       VARCHAR(120),
  target_date TIMESTAMP,
  priority    VARCHAR(20),
  notes       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_roadmap_items_segment ON roadmap_items;
CREATE TRIGGER trg_roadmap_items_segment BEFORE INSERT ON roadmap_items FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_roadmap_items_segment ON roadmap_items(tenant_id, segment_id, horizon);

CREATE TABLE IF NOT EXISTS product_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  version      VARCHAR(50),
  release_date TIMESTAMP,
  status       VARCHAR(20) NOT NULL DEFAULT 'planned',
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_product_releases_segment ON product_releases;
CREATE TRIGGER trg_product_releases_segment BEFORE INSERT ON product_releases FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_product_releases_segment ON product_releases(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS changelog_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  version     VARCHAR(50) NOT NULL,
  title       VARCHAR(255),
  body        TEXT,
  released_at TIMESTAMP,
  status      VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_changelog_entries_segment ON changelog_entries;
CREATE TRIGGER trg_changelog_entries_segment BEFORE INSERT ON changelog_entries FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_changelog_entries_segment ON changelog_entries(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS feature_flags (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  key                VARCHAR(120) NOT NULL,
  name               VARCHAR(255),
  status             VARCHAR(20) NOT NULL DEFAULT 'disabled',  -- disabled|enabled|percentage_rollout|user_targeting
  rollout_percentage INTEGER,
  description        TEXT,
  notes              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_feature_flags_segment ON feature_flags;
CREATE TRIGGER trg_feature_flags_segment BEFORE INSERT ON feature_flags FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_feature_flags_segment ON feature_flags(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS business_value_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  value_type        VARCHAR(20) NOT NULL DEFAULT 'REVENUE',    -- REVENUE|CUSTOMER_KPI|BOTH
  display_mode      VARCHAR(20) NOT NULL DEFAULT 'REVENUE',    -- REVENUE|CUSTOMER_KPI|COMBINED
  reward_multiplier REAL NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_business_value_configs_segment ON business_value_configs;
CREATE TRIGGER trg_business_value_configs_segment BEFORE INSERT ON business_value_configs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_business_value_configs_segment ON business_value_configs(tenant_id, segment_id, is_active);

CREATE TABLE IF NOT EXISTS feature_roi (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  feature_name VARCHAR(255) NOT NULL,
  feature_type VARCHAR(20),                                    -- FEATURE|PAGE|COMPONENT|FLOW|INTEGRATION
  category     VARCHAR(120),
  status       VARCHAR(20) NOT NULL DEFAULT 'TRACKING',        -- TRACKING|COMPLETED|ARCHIVED
  metrics      TEXT,
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_feature_roi_segment ON feature_roi;
CREATE TRIGGER trg_feature_roi_segment BEFORE INSERT ON feature_roi FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_feature_roi_segment ON feature_roi(tenant_id, segment_id, status);
