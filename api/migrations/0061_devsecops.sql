-- Migration: DevSecOps governance surfaces (doc 07 SEC-8/9). Segment-scoped with
-- the 0056 trigger. The RECORDS are CRUD (access reviews, scan register, findings);
-- automated population (who-has-access from repos, running scanners on agent PRs)
-- is the agent/repo-integration piece, tracked separately.

CREATE TABLE IF NOT EXISTS access_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  period       VARCHAR(120) NOT NULL,                       -- e.g. "2026-Q2"
  scope        VARCHAR(20),                                 -- repo|segment|integration|board
  scope_ref    VARCHAR(255),
  status       VARCHAR(20) NOT NULL DEFAULT 'open',         -- open|in_progress|completed|overdue
  reviewer_id  VARCHAR(64),
  due_date     TIMESTAMP,
  completed_at TIMESTAMP,
  findings     TEXT,                                        -- JSON: [{ principalId, currentAccess, decision }]
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_access_reviews_segment ON access_reviews;
CREATE TRIGGER trg_access_reviews_segment BEFORE INSERT ON access_reviews FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_access_reviews_segment ON access_reviews(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS vulnerability_scans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  repo_ref     VARCHAR(255),                                -- repo name/id (no Repo table yet)
  ref          VARCHAR(255),                                -- branch/commit/PR
  scan_type    VARCHAR(20) NOT NULL,                        -- SAST|SCA|SECRET|IAC|CONTAINER
  status       VARCHAR(20) NOT NULL DEFAULT 'queued',       -- queued|running|completed|failed
  triggered_by VARCHAR(64),
  started_at   TIMESTAMP,
  finished_at  TIMESTAMP,
  summary      TEXT,                                        -- JSON: { critical, high, medium, low }
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_vulnerability_scans_segment ON vulnerability_scans;
CREATE TRIGGER trg_vulnerability_scans_segment BEFORE INSERT ON vulnerability_scans FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_vulnerability_scans_segment ON vulnerability_scans(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS vulnerability_findings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  scan_id            UUID NOT NULL REFERENCES vulnerability_scans(id) ON DELETE CASCADE,
  severity           VARCHAR(20) NOT NULL,                  -- CRITICAL|HIGH|MEDIUM|LOW
  rule_id            VARCHAR(120),
  title              VARCHAR(255) NOT NULL,
  file_path          VARCHAR(500),
  line               INTEGER,
  package_name       VARCHAR(255),
  vulnerable_version VARCHAR(64),
  fixed_version      VARCHAR(64),
  cwe                VARCHAR(40),
  cve                VARCHAR(40),
  description        TEXT,
  remediation        TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'open',   -- open|triaged|fixed|accepted_risk|false_positive
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_vulnerability_findings_segment ON vulnerability_findings;
CREATE TRIGGER trg_vulnerability_findings_segment BEFORE INSERT ON vulnerability_findings FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_vulnerability_findings_scan ON vulnerability_findings(tenant_id, segment_id, scan_id, severity);
