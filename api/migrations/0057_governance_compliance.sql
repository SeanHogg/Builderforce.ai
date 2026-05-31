-- Migration: Governance & Security compliance trackers (doc 07, Phase 2).
--
-- The first slice of BuilderForce's security TOOLSET (the full set EXCEPT
-- identity/RBAC/auth, which stay in BurnRateOS). All tables are
-- (tenant_id, segment_id)-scoped like every business entity — segment_id is
-- NOT NULL in the DB and auto-filled by the default-segment trigger from 0056
-- (single tenants → default segment; segmented tenants must set it explicitly).
--
-- This slice: SOC 2 Control Tracker (SEC-1), Vendor/Subprocessor Register
-- (SEC-2), Security Incident Register (SEC-3). Remaining trackers (PII, DPA,
-- training, compliance calendar, DSR, suppression, access reviews, vuln scans,
-- security audit) land in following migrations.

CREATE TABLE IF NOT EXISTS soc_controls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  control_ref  VARCHAR(50) NOT NULL,              -- CC1.1, CC2.1 … (SOC 2 Common Criteria)
  category     VARCHAR(20) NOT NULL,              -- CC1..CC9 | A | C | PI | P
  name         VARCHAR(255) NOT NULL,
  requirement  TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'not_started', -- not_started|in_progress|ready|out_of_scope
  owner_id     VARCHAR(64),
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_soc_controls_segment ON soc_controls;
CREATE TRIGGER trg_soc_controls_segment BEFORE INSERT ON soc_controls FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_soc_controls_segment   ON soc_controls(segment_id);
CREATE INDEX IF NOT EXISTS idx_soc_controls_scope_cat ON soc_controls(tenant_id, segment_id, category);

CREATE TABLE IF NOT EXISTS soc_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  control_id    UUID NOT NULL REFERENCES soc_controls(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  evidence_type VARCHAR(20) NOT NULL,             -- policy|screenshot|log|config|url|note
  url           VARCHAR(1000),
  note          TEXT,
  uploaded_by   VARCHAR(64),
  source_ref    TEXT,                             -- JSON: { kind, agentRunId?, prUrl? }
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_soc_evidence_segment ON soc_evidence;
CREATE TRIGGER trg_soc_evidence_segment BEFORE INSERT ON soc_evidence FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_soc_evidence_segment ON soc_evidence(segment_id);
CREATE INDEX IF NOT EXISTS idx_soc_evidence_control ON soc_evidence(tenant_id, segment_id, control_id);

CREATE TABLE IF NOT EXISTS security_vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  purpose         TEXT,
  region          VARCHAR(100),
  data_classes    TEXT,
  is_subprocessor BOOLEAN NOT NULL DEFAULT false,
  dpa_status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|signed|expired|not_required
  dpa_url         VARCHAR(1000),
  renewal_date    TIMESTAMP,
  contact_email   VARCHAR(255),
  website         VARCHAR(500),
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_security_vendors_segment ON security_vendors;
CREATE TRIGGER trg_security_vendors_segment BEFORE INSERT ON security_vendors FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_security_vendors_segment ON security_vendors(segment_id);
CREATE INDEX IF NOT EXISTS idx_security_vendors_subproc ON security_vendors(tenant_id, segment_id, is_subprocessor);

CREATE TABLE IF NOT EXISTS security_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  title            VARCHAR(255) NOT NULL,
  severity         VARCHAR(20) NOT NULL DEFAULT 'low',  -- critical|high|medium|low
  status           VARCHAR(20) NOT NULL DEFAULT 'open', -- open|investigating|contained|resolved
  discovered_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMP,
  detection_source VARCHAR(40),                         -- monitoring|customer_report|audit|pen_test|agent|other
  impact           TEXT,
  root_cause       TEXT,
  postmortem_url   VARCHAR(1000),
  reported_by      VARCHAR(64),
  assigned_to      VARCHAR(64),
  source_ref       TEXT,                                -- JSON link to vuln finding / agent run
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_security_incidents_segment ON security_incidents;
CREATE TRIGGER trg_security_incidents_segment BEFORE INSERT ON security_incidents FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_security_incidents_segment  ON security_incidents(segment_id);
CREATE INDEX IF NOT EXISTS idx_security_incidents_severity ON security_incidents(tenant_id, segment_id, severity);
CREATE INDEX IF NOT EXISTS idx_security_incidents_status   ON security_incidents(tenant_id, segment_id, status);
