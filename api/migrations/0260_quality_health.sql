-- Migration: Quality Health Dashboard tables (task #297)
-- PRD: Quality Health Dashboard — bug counts, trends, ratios, regression rates, test coverage

-- Quality bug snapshots — periodic snapshots of bug counts from issue trackers
CREATE TABLE quality_bug_snapshots (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL, -- github_issues | jira | linear | azure_devops | custom
  source_issue_id VARCHAR(255) NOT NULL,
  title TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL, -- critical | high | medium | low
  status VARCHAR(20) NOT NULL, -- open | closed
  component VARCHAR(255),
  assignee VARCHAR(255),
  labels JSONB DEFAULT '[]'::jsonb,
  milestone VARCHAR(255),
  release_tag VARCHAR(255),
  opened_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quality_bug_snapshots_tenant_project ON quality_bug_snapshots(tenant_id, project_id, snapshot_at);
CREATE INDEX idx_quality_bug_snapshots_source ON quality_bug_snapshots(source, source_issue_id);
CREATE INDEX idx_quality_bug_snapshots_severity ON quality_bug_snapshots(severity, status);
CREATE INDEX idx_quality_bug_snapshots_release ON quality_bug_snapshots(release_tag);

-- Quality coverage reports — per-commit coverage summaries from CI artifacts
CREATE TABLE quality_coverage_reports (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha VARCHAR(255) NOT NULL,
  report_format VARCHAR(20) NOT NULL, -- lcov | cobertura | jacoco | istanbul
  line_pct REAL,
  branch_pct REAL,
  function_pct REAL,
  module_breakdown JSONB DEFAULT '[]'::jsonb, -- [{name, linePct, branchPct, functionPct}]
  ingested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quality_coverage_reports_tenant_project ON quality_coverage_reports(tenant_id, project_id, commit_sha);
CREATE INDEX idx_quality_coverage_reports_ingested ON quality_coverage_reports(ingested_at);

-- Quality threshold configs — per-entity threshold overrides for alerting
CREATE TABLE quality_threshold_configs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL, -- org | project | team
  scope_id INTEGER,
  metric_key VARCHAR(50) NOT NULL, -- open_closed_ratio | regression_rate | coverage_floor | anomaly_spike_pct | coverage_delta
  threshold_value REAL NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quality_threshold_configs_tenant_scope ON quality_threshold_configs(tenant_id, scope_type, scope_id, metric_key);

-- Quality integration configs — OAuth2/API-token connections for issue trackers and CI systems
CREATE TABLE quality_integration_configs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- github | jira | linear | azure_devops | github_actions | gitlab_ci | jenkins | circleci | buildkite
  credential_enc TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  config JSONB DEFAULT '{}'::jsonb, -- base URLs, org/project mappings
  sync_schedule_minutes INTEGER DEFAULT 15,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quality_integration_configs_tenant_project ON quality_integration_configs(tenant_id, project_id, provider);

-- Quality regression events — materialised regression classifications
CREATE TABLE quality_regression_events (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  bug_snapshot_id INTEGER REFERENCES quality_bug_snapshots(id) ON DELETE CASCADE,
  release_tag VARCHAR(255),
  component VARCHAR(255),
  classified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quality_regression_events_tenant_project ON quality_regression_events(tenant_id, project_id);
CREATE INDEX idx_quality_regression_events_release ON quality_regression_events(release_tag);

-- Quality alert log — fired alert audit trail
CREATE TABLE quality_alert_log (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  metric_key VARCHAR(50) NOT NULL,
  current_value REAL NOT NULL,
  threshold_value REAL NOT NULL,
  channel VARCHAR(20) NOT NULL, -- email | slack | teams | pagerduty
  fired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP
);

CREATE INDEX idx_quality_alert_log_tenant_project ON quality_alert_log(tenant_id, project_id, fired_at);
CREATE INDEX idx_quality_alert_log_metric ON quality_alert_log(metric_key, fired_at);
