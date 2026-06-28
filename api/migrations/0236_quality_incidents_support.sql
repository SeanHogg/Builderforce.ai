-- 0236_quality_incidents_support.sql
-- QUALITY slide collectors — the ops/support metrics nothing else collects.
-- The existing lenses give deploy-tied MTTR/change-failure (deployment_events,
-- 0118) and post-merge defects (qa_findings, 0214); the genuine gap is
-- PRODUCTION incidents (not deploy-tied), customer-support volume, and uptime.
--
--   prod_incidents — sev/status, started_at→resolved_at = MTTR, is_alert_only =
--                    the Alerts count; fed by PagerDuty/Sentry webhooks (boardsync)
--                    keyed by external_ref, or entered manually.
--   support_tickets — Support Issues / Tech Support Tix; is_bug = post-prod bugs,
--                     customer_ref → tix-per-customer; fed by Freshservice/
--                     ServiceNow poll or manual.
--   uptime_samples — daily Uptime %; status-page connector pending → manual.
--
-- Idempotent: CREATE ... IF NOT EXISTS so it is safe to re-run. tenant + segment
-- scoped via the shared set_default_segment_id() trigger (segment_id nullable in
-- DDL, trigger-filled — same as 0226).

CREATE TABLE IF NOT EXISTS prod_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title           VARCHAR(255) NOT NULL,
  severity        VARCHAR(16) NOT NULL DEFAULT 'sev3',   -- sev1 | sev2 | sev3 | sev4
  status          VARCHAR(16) NOT NULL DEFAULT 'open',   -- open | acknowledged | mitigated | resolved
  is_alert_only   BOOLEAN NOT NULL DEFAULT FALSE,
  source          VARCHAR(24) NOT NULL DEFAULT 'manual', -- pagerduty | sentry | datadog | manual
  external_ref    VARCHAR(255),
  started_at      TIMESTAMP NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMP,
  resolved_at     TIMESTAMP,
  impact          TEXT,
  root_cause      TEXT,
  postmortem_url  VARCHAR(512),
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_incidents_started ON prod_incidents(tenant_id, started_at);
CREATE INDEX IF NOT EXISTS idx_prod_incidents_status ON prod_incidents(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_incidents_external ON prod_incidents(tenant_id, source, external_ref);

DROP TRIGGER IF EXISTS trg_prod_incidents_segment ON prod_incidents;
CREATE TRIGGER trg_prod_incidents_segment
  BEFORE INSERT ON prod_incidents
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS support_tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  source       VARCHAR(24) NOT NULL DEFAULT 'manual',  -- freshservice | servicenow | zendesk | manual
  external_ref VARCHAR(255),
  subject      VARCHAR(512),
  category     VARCHAR(24) NOT NULL DEFAULT 'other',   -- bug | how_to | billing | feature_request | other
  is_bug       BOOLEAN NOT NULL DEFAULT FALSE,
  priority     VARCHAR(16) NOT NULL DEFAULT 'normal',
  status       VARCHAR(16) NOT NULL DEFAULT 'open',
  customer_ref VARCHAR(255),
  opened_at    TIMESTAMP NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_opened ON support_tickets(tenant_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_bug ON support_tickets(tenant_id, is_bug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_tickets_external ON support_tickets(tenant_id, source, external_ref);

DROP TRIGGER IF EXISTS trg_support_tickets_segment ON support_tickets;
CREATE TRIGGER trg_support_tickets_segment
  BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS uptime_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  service_name     VARCHAR(120) NOT NULL DEFAULT 'production',
  period_day       DATE NOT NULL,
  uptime_pct       REAL NOT NULL DEFAULT 100,   -- 0..100 for the day
  downtime_minutes REAL NOT NULL DEFAULT 0,
  source           VARCHAR(24) NOT NULL DEFAULT 'manual', -- statuspage | pingdom | betterstack | manual
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uptime_samples_day ON uptime_samples(tenant_id, period_day);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uptime_samples_day ON uptime_samples(tenant_id, service_name, period_day);

DROP TRIGGER IF EXISTS trg_uptime_samples_segment ON uptime_samples;
CREATE TRIGGER trg_uptime_samples_segment
  BEFORE INSERT ON uptime_samples
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- Defect-aging buckets read OPEN qa_findings at tenant grain (0214 only added
-- project-scoped variants).
CREATE INDEX IF NOT EXISTS idx_qa_findings_tenant_status_created
  ON qa_findings(tenant_id, status, created_at);
