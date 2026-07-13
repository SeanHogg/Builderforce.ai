-- 0231_custom_dashboards.sql
-- Custom Dashboards + AI-Powered Queries.
--
-- Managers compose SAVED DASHBOARDS out of WIDGETS over EXISTING metrics. A widget
-- never carries SQL — it carries a whitelisted `metric_key` (e.g. 'finance.spend',
-- 'dora.deployFreq') resolved server-side by the metric registry to an existing
-- compute* service. AI queries map a natural-language question to one of the same
-- whitelisted keys via a deterministic intent parser (never raw LLM SQL); the
-- question + matched metric are recorded in saved_queries for history/audit.
--
-- Idempotent / re-runnable.

-- ── Saved dashboards (a named widget layout, segment-scoped) ──────────────────
CREATE TABLE IF NOT EXISTS saved_dashboards (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  name        VARCHAR(160) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  VARCHAR(36),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_dashboards_tenant ON saved_dashboards(tenant_id);

-- ── Dashboard widgets (each = a whitelisted metric source + viz type + config) ─
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dashboard_id  INTEGER NOT NULL REFERENCES saved_dashboards(id) ON DELETE CASCADE,
  metric_key    VARCHAR(64) NOT NULL,                -- whitelisted registry key
  viz           VARCHAR(16) NOT NULL DEFAULT 'stat', -- stat | bar | line | gauge
  title         VARCHAR(160),
  config        JSONB NOT NULL DEFAULT '{}',         -- per-widget options (e.g. { days })
  position      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_tenant    ON dashboard_widgets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id);

-- ── Saved NL queries (history of asked questions → matched metric) ────────────
CREATE TABLE IF NOT EXISTS saved_queries (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  matched_metric  VARCHAR(64),
  created_by      VARCHAR(36),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_tenant ON saved_queries(tenant_id);
