-- Migration: Agentic QA — per-project targets + credential library (personas).
--
-- Extends the QA suite (0063) from one workspace-level target+login to a
-- per-project model: each project has one or more site-under-test URLs
-- (qa_targets) and a library of named test personas (qa_credentials) whose
-- passwords are AES-GCM encrypted at rest. Flows/tests/runs gain project_id +
-- credential_id so an AI-generated scenario runs as a chosen persona.
--
-- Tenant-scoped tables use the 0056 set_default_segment_id trigger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qa_targets — per-project site(s)-under-test
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_targets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID         REFERENCES segments(id) ON DELETE CASCADE,
  project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  base_url    VARCHAR(512) NOT NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT false,
  status      VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_targets_segment ON qa_targets;
CREATE TRIGGER trg_qa_targets_segment BEFORE INSERT ON qa_targets FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_targets_project ON qa_targets(tenant_id, project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. qa_credentials — per-project credential library (test personas).
--    secret_enc holds the AES-GCM-encrypted password ("iv.cipher").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_credentials (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID         REFERENCES segments(id) ON DELETE CASCADE,
  project_id      INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label           VARCHAR(255) NOT NULL,
  role            VARCHAR(64),
  username        VARCHAR(512) NOT NULL,
  secret_enc      TEXT         NOT NULL,
  login_url       VARCHAR(512),
  login_selectors TEXT,
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_credentials_segment ON qa_credentials;
CREATE TRIGGER trg_qa_credentials_segment BEFORE INSERT ON qa_credentials FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_credentials_project ON qa_credentials(tenant_id, project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Project scoping + persona links on the existing QA tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE qa_flows
  ADD COLUMN IF NOT EXISTS project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS persona_role  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES qa_credentials(id) ON DELETE SET NULL;

ALTER TABLE qa_tests
  ADD COLUMN IF NOT EXISTS project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES qa_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS persona_role  VARCHAR(64);

ALTER TABLE qa_runs
  ADD COLUMN IF NOT EXISTS project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES qa_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_id     UUID REFERENCES qa_targets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_qa_flows_project ON qa_flows(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_qa_tests_project ON qa_tests(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_project  ON qa_runs(tenant_id, project_id);
