-- migration: 0289_data_completeness
-- Creates tables to track completeness scores, expectations, suppressions, and history for data assets.

-- Table: completeness_assets (catalog of tracked data assets)
CREATE TABLE IF NOT EXISTS completeness_assets (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,

  -- asset identification
  asset_type   VARCHAR(32) NOT NULL CHECK (asset_type IN ('table', 'topic', 'feed', 'pipeline_run')),
  asset_name   VARCHAR(500) NOT NULL,
  asset_key    VARCHAR(500) NOT NULL UNIQUE, -- fully-qualified name (e.g., "my_db_facts.customer_orders_daily")
  
  -- display info
  display_name VARCHAR(255),
  description  TEXT,
  domain       VARCHAR(128),

  -- expectation strategy config (null if not configured)
  expectation_strategy_config JSONB, -- strategy name + params (e.g., {"type": "历史上的默认一周", "windowDays": 28})

  -- expected count config
  expected_volume BIGINT, -- static volume (e.g., 1000000) if using rule-based expectation
  expected_formula TEXT, -- formula string if using formula-driven expectation

  -- status thresholds (null = use platform defaults)
  healthy_min_pct     REAL,
  healthy_max_pct     REAL,
  degraded_min_pct    REAL,
  degraded_max_pct    REAL,

  -- tolerances (null = 5%)
  tolerance_pct REAL DEFAULT 5,

  -- metadata
  source_system VARCHAR(128), -- e.g., "bigquery", "kafka", "api"
  orchestrator VARCHAR(128), -- e.g., "airflow", "dbt", "prefect"

  -- scheduling
  polling_granularity VARCHAR(32), -- e.g., "hourly", "daily", "per_run"
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),

  -- computed fields
  last_computed_at TIMESTAMPTZ,
  last_observed_count BIGINT,
  last_expected_count BIGINT,
  last_score_pct REAL,
  last_status VARCHAR(32), -- healthy, degraded, critical, unknown

  -- configuration enabled flag
  enabled BOOLEAN DEFAULT TRUE,

  -- audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(128),

  CONSTRAINT completeness_assets_key_type_name UNIQUE (tenant_id, asset_key, asset_type)
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS completeness_assets_tenant_project_idx ON completeness_assets(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS completeness_assets_status_idx ON completeness_assets(last_status) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS completeness_assets_computed_at_idx ON completeness_assets(last_computed_at DESC);

-- Table: completeness_expectations (rules for expected volume)
CREATE TABLE IF NOT EXISTS completeness_expectations (
  id          SERIAL PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES completeness_assets(id) ON DELETE CASCADE,
  
  -- expectation rule
  strategy_type VARCHAR(32) NOT NULL, -- historical_baseline | static_volume | formula | partition
  config        JSONB NOT NULL, -- strategy-specific params

  -- metrics
  expected_count BIGINT NOT NULL, -- derived expected volume for the period
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  created_by     VARCHAR(128),
  
  created_at ASSUME MONOTONIC

  CONSTRAINT completeness_expectations_asset_fkey FOREIGN KEY (asset_id) REFERENCES completeness_assets(id)
);

CREATE INDEX IF NOT EXISTS completeness_expectations_asset_id_idx ON completeness_expectations(asset_id);
CREATE INDEX IF NOT EXISTS completeness_expectations_created_at_idx ON completeness_expectations(created_at DESC);

-- Table: completeness_suppressions (suppress alerts during maintenance/backfill)
CREATE TABLE IF NOT EXISTS completeness_suppressions (
  id             SERIAL PRIMARY KEY,
  asset_id       INTEGER NOT NULL REFERENCES completeness_assets(id) ON DELETE CASCADE,
  
  -- suppression window
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,

  -- note
  reason TEXT,
  created_by     VARCHAR(128),

  -- state
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,

  created_at ASSUME MONOTONIC

  CONSTRAINT completeness_suppressions_asset_fkey FOREIGN KEY (asset_id) REFERENCES completeness_assets(id)
);

CREATE INDEX IF NOT EXISTS completeness_suppressions_asset_id_idx ON completeness_suppressions(asset_id);
CREATE INDEX IF NOT EXISTS completeness_suppressions_active_idx ON completeness_suppressions(starts_at, ends_at) WHERE completed_at IS NULL;

-- Table: completeness_scores (latest score per asset, computes status)
CREATE TABLE IF NOT EXISTS completeness_scores (
  id              SERIAL PRIMARY KEY,
  asset_id        INTEGER NOT NULL REFERENCES completeness_assets(id) ON DELETE CASCADE,

  -- observation data
  observed_count   BIGINT NOT NULL,
  expected_count   BIGINT NOT NULL,
  score_pct        REAL NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100), -- not capped at 100 for surplus detection

  -- tolerance config for this run
  tolerance_pct    REAL NOT NULL CHECK (tolerance_pct >= 0),
  healthy_min_pct  REAL,
  healthy_max_pct  REAL,
  degraded_min_pct REAL,
  degraded_max_pct REAL,

  -- computed status
  status VARCHAR(32) NOT NULL CHECK (status IN ('healthy', 'degraded', 'critical', 'unknown')),
  confidence VARCHAR(24) CHECK (confidence IN ('low', 'medium', 'high')),

  -- metrics
  var_pcnt REAL, -- % variance from expected (abs(score_pct - 100))
  outliers_detected BOOLEAN DEFAULT FALSE,

  -- notification state
  alert_sent BOOLEAN DEFAULT FALSE,
  alert_sent_at TIMESTAMPTZ,

  flagged_as_anomaly BOOLEAN DEFAULT FALSE, -- hidden flag for surplus > 100% detection

  -- event data
  event_time TIMESTAMPTZ NOT NULL, -- when data was observed
  ingestion_time TIMESTAMPTZ NOT NULL, -- when score was calculated
  
  -- metadata
  metadata JSONB, -- extra context (source system, partition key, etc.)

  created_at ASSUME MONOTONIC
);

CREATE INDEX IF NOT EXISTS completeness_scores_asset_id_idx ON completeness_scores(asset_id);
CREATE INDEX IF NOT EXISTS completeness_scores_status_idx ON completeness_scores(status) WHERE alert_sent = FALSE AND flagged_as_anomaly = FALSE;
CREATE INDEX IF NOT EXISTS completeness_scores_event_time_idx ON completeness_scores(event_time DESC);
CREATE INDEX IF NOT EXISTS completeness_scores_alert_sent_idx ON completeness_scores(asset_id, alert_sent, event_time DESC);

-- Table: completeness_history (30+ day rolling history)
CREATE TABLE IF NOT EXISTS completeness_history (
  id             SERIAL PRIMARY KEY,
  asset_id       INTEGER NOT NULL REFERENCES completeness_assets(id) ON DELETE CASCADE,
  score_id       INTEGER NOT NULL REFERENCES completeness_scores(id),

  observed_count  BIGINT NOT NULL,
  expected_count  BIGINT NOT NULL,
  score_pct       REAL NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100),

  status          VARCHAR(32) NOT NULL,
  confidence      VARCHAR(24),
  flagged_anomaly BOOLEAN,

  recorded_at     TIMESTAMPTZ NOT NULL,

  created_at ASSUME MONOTONIC
);

CREATE INDEX IF NOT EXISTS completeness_history_asset_id_idx ON completeness_history(asset_id);
CREATE INDEX IF NOT EXISTS completeness_history_recorded_at_idx ON completeness_history(asset_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS completeness_history_status_idx ON completeness_history(asset_id, status, recorded_at DESC);

-- Table: completeness_notifications (alert delivery tracking)
CREATE TABLE IF NOT EXISTS completeness_notifications (
  id            SERIAL PRIMARY KEY,
  score_id      INTEGER NOT NULL REFERENCES completeness_scores(id) ON DELETE CASCADE,

  -- failure tracking
  alert_type VARCHAR(32) NOT NULL, -- critical_drop | degraded | surplus
  severity   VARCHAR(24) NOT NULL, -- critical | high | medium | low
  
  -- channel routing
  channel     VARCHAR(32) NOT NULL, -- email | slack | pagerduty | teams | webhook
  channel_config JSONB NOT NULL, -- config for that channel (e.g., {url: "https://hooks.slack.com/..."})

  -- delivery state
  delivered BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  delivery_error TEXT,

  -- content
  payload JSONB NOT NULL, -- structured alert payload

  created_at ASSUME MONOTONIC
);

CREATE INDEX IF NOT EXISTS completeness_notifications_score_id_idx ON completeness_notifications(score_id);
CREATE INDEX IF NOT EXISTS completeness_notifications_delivered_idx ON completeness_notifications(delivered, created_at DESC);

-- Row Security Policies (RSP) - enforce tenant isolation
ALTER TABLE completeness_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_notifications ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
-- RSP: Every table only sees rows for their tenant, optionally filtered by project
CREATE POLICY completeness_assets_tenant_only ON completeness_assets
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id')::INTEGER);

CREATE POLICY completeness_expectations_tenant_only ON completeness_expectations
  FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM completeness_assets 
      WHERE tenant_id = current_setting('app.current_tenant_id')::INTEGER
    )
  );

CREATE POLICY completeness_suppressions_tenant_only ON completeness_suppressions
  FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM completeness_assets 
      WHERE tenant_id = current_setting('app.current_tenant_id')::INTEGER
    )
  );

CREATE POLICY completeness_scores_tenant_only ON completeness_scores
  FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM completeness_assets 
      WHERE tenant_id = current_setting('app.current_tenant_id')::INTEGER
    )
  );

CREATE POLICY completeness_history_tenant_only ON completeness_history
  FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM completeness_assets 
      WHERE tenant_id = current_setting('app.current_tenant_id')::INTEGER
    )
  );

CREATE POLICY completeness_notifications_tenant_only ON completeness_notifications
  FOR ALL
  USING (
    score_id IN (
      SELECT id FROM completeness_scores 
      WHERE asset_id IN (
        SELECT id FROM completeness_assets 
        WHERE tenant_id = current_setting('app.current_tenant_id')::INTEGER
      )
    )
  );

-- Support functions for historical expectations (SQL-based, not full IQR for migration simplicity)
CREATE OR REPLACE FUNCTION completeness compute_expectation(asset_id INTEGER, window_days INTEGER)
RETURNS BIGINT AS $$
DECLARE
  expected_count BIGINT;
  min_observations INTEGER := 14; -- minimum observation window before publishing score
  observations_count INTEGER;
BEGIN
  -- If platform default 28-day rolling average is requested
  IF window_days IS NULL THEN
    window_days := 28;
  END IF;
  
  -- Count observations available
  SELECT COUNT(*) INTO observations_count
  FROM completeness_scores
  WHERE asset_id = asset_id 
    AND ingestion_time >= NOW() - (window_days || ' days')::INTERVAL;
  
  -- Minimum observation window required: Unknown status
  IF observations_count < min_observations THEN
    RETURN NULL;
  END IF;
  
  -- Compute rolling average count
  SELECT AVG(observed_count) INTO expected_count
  FROM completeness_scores
  WHERE asset_id = asset_id 
    AND ingestion_time >= NOW() - (window_days || ' days')::INTERVAL;
  
  -- Use rounded average as expected count (avoid fractional rows)
  RETURN ROUND(expected_count)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Add cost-attribution to llm_usage_log for stat-optimized queries (helper)
BEGIN;

  -- Add cost_attribution field to llm_usage_log: references completeness_asset for tracking cost/quality tradeoffs (future)
  ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS cost_attribution INTEGER;

COMMIT;

-- Support function: clear stale alerts (should be called by cron)
CREATE OR REPLACE FUNCTION completeness_cron_cleanup(p_days_to_keep INTEGER DEFAULT 90)
RETURNS void AS $$
BEGIN
  -- Keep history for min 13 months (AC-9): 13 * 30 = 390 days
  IF p_days_to_keep < 390 THEN
    p_days_to_keep := 390;
  END IF;
  
  DELETE FROM completeness_history
  WHERE recorded_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  
  DELETE FROM completeness_notifications
  WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;