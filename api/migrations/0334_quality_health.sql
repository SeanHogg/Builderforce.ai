-- 0334_quality_health.sql
-- Quality Health Dashboard (task #297) — canonical storage for bug inventory,
-- coverage reports, regression events, thresholds, integrations, and alert audit.
-- Pure DDL — ADD COLUMN IF EXISTS / IF NOT EXISTS so re-runs are idempotent,
-- consistent with 0250/0333. Numeric prefix 0260 on the original draft collided
-- with 0260_ide_agent_psychometric and was NOT in
-- .migration-collisions-allowlist.txt — renamed to 0334 (next free slot at time
-- of authoring). Additive — no drops.
--
-- Storage convention: UUID PKs with gen_random_uuid() (see 0250, 0269+). All
-- `created_*` columns are DEFAULT now(). JSONB uses jsonb columns in drizzle
-- (but this migration pins `text`/`jsonb` explicitly for ledger compatibility
-- with the runner — drizzle will decode as needed per the barrel).

-- Bug inventory snapshots — periodic ingestion of issue-tracker state. One row is
-- ONE open/closed bug observed at a particular sync; the materialized *count* is
-- derived at query time (bugCountFromSnapshots) so re-syncs are cheap replaces.
CREATE TABLE IF NOT EXISTS quality_bug_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      integer REFERENCES projects(id) ON DELETE CASCADE,
  source          varchar(50) NOT NULL,                 -- github_issues | jira | linear | azure_devops | custom
  source_issue_id varchar(255) NOT NULL,
  title           text NOT NULL,
  severity        varchar(20) NOT NULL,                  -- critical | high | medium | low
  status          varchar(20) NOT NULL,                  -- open | closed
  component       varchar(255),
  team_label      varchar(255),
  assignee        varchar(255),
  labels          jsonb DEFAULT '[]'::jsonb,
  milestone       varchar(255),
  release_tag     varchar(255),
  opened_at       timestamp NOT NULL,
  closed_at       timestamp,
  snapshot_at     timestamp NOT NULL DEFAULT now(),
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_bug_snapshots_tenant_project ON quality_bug_snapshots(tenant_id, project_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_quality_bug_snapshots_source ON quality_bug_snapshots(source, source_issue_id);
CREATE INDEX IF NOT EXISTS idx_quality_bug_snapshots_severity ON quality_bug_snapshots(severity, status);
CREATE INDEX IF NOT EXISTS idx_quality_bug_snapshots_release ON quality_bug_snapshots(release_tag);

-- Coverage reports — per-commit coverage summaries scraped from CI artifacts.
CREATE TABLE IF NOT EXISTS quality_coverage_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id       integer REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha       varchar(255) NOT NULL,
  report_format    varchar(20) NOT NULL,   -- lcov | cobertura | jacoco | istanbul
  line_pct         real,
  branch_pct       real,
  function_pct     real,
  module_breakdown jsonb DEFAULT '[]'::jsonb,  -- [{name, linePct, branchPct, functionPct}]
  ingested_at      timestamp NOT NULL DEFAULT now(),
  created_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_coverage_reports_tenant_project ON quality_coverage_reports(tenant_id, project_id, commit_sha);
CREATE INDEX IF NOT EXISTS idx_quality_coverage_reports_ingested ON quality_coverage_reports(ingested_at);

-- Threshold configs — org / project / team overrides for quality metrics. A row
-- with metric_key `open_closed_ratio` = 2 means "red above 2:1".
CREATE TABLE IF NOT EXISTS quality_threshold_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_type      varchar(20) NOT NULL,    -- org | project | team
  scope_id        integer,
  metric_key      varchar(50) NOT NULL,    -- open_closed_ratio | regression_rate | coverage_floor | anomaly_spike_pct | coverage_delta
  threshold_value real NOT NULL,
  enabled         boolean NOT NULL DEFAULT TRUE,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_threshold_configs_tenant_scope ON quality_threshold_configs(tenant_id, scope_type, scope_id, metric_key);

-- Integration configs — sealed credentials + sync settings for provider sync.
CREATE TABLE IF NOT EXISTS quality_integration_configs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id               integer REFERENCES projects(id) ON DELETE CASCADE,
  provider                 varchar(50) NOT NULL,  -- github | jira | linear | azure_devops | github_actions | gitlab_ci | jenkins | circleci | buildkite
  credential_enc           text NOT NULL,
  credential_iv            text NOT NULL,
  config                   jsonb DEFAULT '{}'::jsonb,
  sync_schedule_minutes    integer DEFAULT 15,
  is_active                boolean NOT NULL DEFAULT TRUE,
  last_sync_at             timestamp,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_integration_configs_tenant_project ON quality_integration_configs(tenant_id, project_id, provider);

-- Regression events — materialised classifications. `bug_snapshot_id` is the
-- regression bug itself (a newly filed bug against a recently-fixed component).
CREATE TABLE IF NOT EXISTS quality_regression_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      integer REFERENCES projects(id) ON DELETE CASCADE,
  bug_snapshot_id uuid REFERENCES quality_bug_snapshots(id) ON DELETE CASCADE,
  release_tag     varchar(255),
  component       varchar(255),
  classified_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_regression_events_tenant_project ON quality_regression_events(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_quality_regression_events_release ON quality_regression_events(release_tag);

-- Alert log — auditable history of fired threshold alerts (channels = email|slack|…).
CREATE TABLE IF NOT EXISTS quality_alert_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      integer REFERENCES projects(id) ON DELETE CASCADE,
  metric_key      varchar(50) NOT NULL,
  current_value   real NOT NULL,
  threshold_value real NOT NULL,
  channel         varchar(20) NOT NULL,  -- email | slack | teams | pagerduty
  fired_at        timestamp NOT NULL DEFAULT now(),
  acknowledged_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_quality_alert_log_tenant_project ON quality_alert_log(tenant_id, project_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_quality_alert_log_metric ON quality_alert_log(metric_key, fired_at);
