-- Migration: remaining Governance & Security trackers (doc 07, Phase 2).
--
-- Completes the security toolset's data layer alongside 0057 (SOC2, vendors,
-- incidents). All (tenant_id, segment_id)-scoped with the 0056 default-segment
-- trigger. DSR + suppression are the per-Segment data-privacy tools (govern the
-- Segment's data only; BurnRateOS keeps its own platform-global shared-graph DSR).

CREATE TABLE IF NOT EXISTS pii_data_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  classification   VARCHAR(20) NOT NULL DEFAULT 'internal',   -- public|internal|confidential|restricted
  data_categories  TEXT,
  storage_location VARCHAR(255),
  retention_days   INTEGER,
  legal_basis      VARCHAR(40),                               -- contract|consent|legitimate_interest|legal_obligation
  owner_team       VARCHAR(255),
  last_reviewed_at TIMESTAMP,
  notes            TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_pii_data_assets_segment ON pii_data_assets;
CREATE TRIGGER trg_pii_data_assets_segment BEFORE INSERT ON pii_data_assets FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_pii_data_assets_segment ON pii_data_assets(tenant_id, segment_id, classification);

CREATE TABLE IF NOT EXISTS security_dpas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  counterparty_name VARCHAR(255) NOT NULL,
  counterparty_type VARCHAR(20) NOT NULL DEFAULT 'vendor',    -- vendor|customer|subprocessor
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',     -- draft|signed|expired|terminated
  signed_at         TIMESTAMP,
  effective_date    TIMESTAMP,
  renewal_date      TIMESTAMP,
  dpa_url           VARCHAR(1000),
  scc_version       VARCHAR(50),
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_security_dpas_segment ON security_dpas;
CREATE TRIGGER trg_security_dpas_segment BEFORE INSERT ON security_dpas FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_security_dpas_segment ON security_dpas(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS security_trainings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  user_id         VARCHAR(64),
  user_name       VARCHAR(255) NOT NULL,
  user_email      VARCHAR(255),
  training_type   VARCHAR(40) NOT NULL,                       -- phishing|sec_awareness|soc2_ready|gdpr|custom
  training_name   VARCHAR(255) NOT NULL,
  completed_at    TIMESTAMP,
  due_date        TIMESTAMP,
  status          VARCHAR(20) NOT NULL DEFAULT 'not_started', -- not_started|in_progress|completed|overdue
  certificate_url VARCHAR(1000),
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_security_trainings_segment ON security_trainings;
CREATE TRIGGER trg_security_trainings_segment BEFORE INSERT ON security_trainings FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_security_trainings_segment ON security_trainings(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS compliance_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  framework       VARCHAR(20) NOT NULL,                       -- soc2|gdpr|ccpa|sox|hipaa|custom
  event_type      VARCHAR(20) NOT NULL DEFAULT 'milestone',   -- milestone|evidence_refresh|audit|renewal
  due_date        TIMESTAMP NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'upcoming',    -- upcoming|in_progress|completed|overdue
  assigned_to     VARCHAR(64),
  is_recurring    BOOLEAN NOT NULL DEFAULT false,
  recurring_every VARCHAR(20),
  notes           TEXT,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_compliance_events_segment ON compliance_events;
CREATE TRIGGER trg_compliance_events_segment BEFORE INSERT ON compliance_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_compliance_events_segment ON compliance_events(tenant_id, segment_id, due_date);

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  request_type        VARCHAR(20) NOT NULL,                   -- access|erasure|rectification|portability|objection|opt_out
  subject_email       VARCHAR(255) NOT NULL,
  subject_email_hash  VARCHAR(64),
  jurisdiction        VARCHAR(40),
  notes               TEXT,
  status              VARCHAR(30) NOT NULL DEFAULT 'verifying_identity', -- verifying_identity|pending|processing|completed|rejected
  verified_at         TIMESTAMP,
  processed_by_user_id VARCHAR(64),
  processed_at        TIMESTAMP,
  rejection_reason    TEXT,
  submitted_ip        VARCHAR(64),
  submitted_user_agent VARCHAR(500),
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_data_subject_requests_segment ON data_subject_requests;
CREATE TRIGGER trg_data_subject_requests_segment BEFORE INSERT ON data_subject_requests FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_data_subject_requests_segment ON data_subject_requests(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS data_suppression_list (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  identifier_type   VARCHAR(20) NOT NULL,                     -- email|linkedin_url|github_login|phone_e164|domain
  identifier_value  VARCHAR(500) NOT NULL,
  identifier_hash   VARCHAR(64),
  reason            VARCHAR(40) NOT NULL,                     -- erasure_request|user_opt_out|hard_bounce|spam_complaint|manual_admin_add
  added_by_user_id  VARCHAR(64),
  added_by_dsr_id   UUID,
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_data_suppression_list_segment ON data_suppression_list;
CREATE TRIGGER trg_data_suppression_list_segment BEFORE INSERT ON data_suppression_list FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_suppression_list_identifier ON data_suppression_list(tenant_id, segment_id, identifier_type, identifier_value);
