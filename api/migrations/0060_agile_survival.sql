-- Migration: Agile Survival net-new CRUD features (doc 03). Segment-scoped with
-- the 0056 trigger. Back the Agile embed surfaces sprints/velocity/capacity/cost/
-- feature-scoring via the generic tracker factory. (poker + retros need realtime
-- rooms and are built separately.)

CREATE TABLE IF NOT EXISTS sprints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  goal          TEXT,
  start_date    TIMESTAMP,
  end_date      TIMESTAMP,
  capacity      INTEGER,
  status        VARCHAR(20) NOT NULL DEFAULT 'planning',   -- planning|active|completed|archived
  runway_budget REAL,
  actual_burn   REAL,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_sprints_segment ON sprints;
CREATE TRIGGER trg_sprints_segment BEFORE INSERT ON sprints FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_sprints_segment ON sprints(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS team_velocity (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  period           VARCHAR(120) NOT NULL,
  team_id          VARCHAR(64),
  period_start     TIMESTAMP,
  period_end       TIMESTAMP,
  committed_points INTEGER,
  completed_points INTEGER,
  velocity_score   REAL,
  trend            VARCHAR(20),
  notes            TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_team_velocity_segment ON team_velocity;
CREATE TRIGGER trg_team_velocity_segment BEFORE INSERT ON team_velocity FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_team_velocity_segment ON team_velocity(tenant_id, segment_id, period_start);

CREATE TABLE IF NOT EXISTS capacity_planning (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  planning_period    VARCHAR(120) NOT NULL,
  team_id            VARCHAR(64),
  total_capacity     REAL,
  allocated_capacity REAL,
  available_capacity REAL,
  utilization_rate   REAL,
  team_size          INTEGER,
  notes              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_capacity_planning_segment ON capacity_planning;
CREATE TRIGGER trg_capacity_planning_segment BEFORE INSERT ON capacity_planning FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_capacity_planning_segment ON capacity_planning(tenant_id, segment_id, planning_period);

CREATE TABLE IF NOT EXISTS cost_calculations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  label               VARCHAR(255) NOT NULL,
  calculation_type    VARCHAR(40),
  labor_cost          REAL,
  overhead_cost       REAL,
  tooling_cost        REAL,
  infrastructure_cost REAL,
  total_cost          REAL,
  runway_impact_days  INTEGER,
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_cost_calculations_segment ON cost_calculations;
CREATE TRIGGER trg_cost_calculations_segment BEFORE INSERT ON cost_calculations FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_cost_calculations_segment ON cost_calculations(tenant_id, segment_id);

CREATE TABLE IF NOT EXISTS feature_scores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  reach      REAL,
  impact     REAL,
  confidence REAL,
  effort     REAL,
  score      REAL,
  status     VARCHAR(20) NOT NULL DEFAULT 'draft',
  notes      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_feature_scores_segment ON feature_scores;
CREATE TRIGGER trg_feature_scores_segment BEFORE INSERT ON feature_scores FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_feature_scores_segment ON feature_scores(tenant_id, segment_id, status);
