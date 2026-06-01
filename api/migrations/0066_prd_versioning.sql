-- Migration: PRD versioning & audit (Slice 3).
-- The PRD/spec becomes the durable, versioned contract every swimlane/agent
-- executes against. spec_versions are immutable snapshots (frozen once an
-- execution references them). spec_audit_records give PRD-coordinate provenance
-- (agent action x PRD section x swimlane). tasks.spec_id ties a backlog ticket
-- to the PRD it implements.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS spec_id UUID REFERENCES specs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS spec_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  spec_id    UUID NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  prd        TEXT,
  arch_spec  TEXT,
  task_list  TEXT,
  origin     VARCHAR(24) NOT NULL DEFAULT 'prd_first',
  frozen     BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_at  TIMESTAMP,
  created_by VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_spec_version UNIQUE (spec_id, version)
);
DROP TRIGGER IF EXISTS trg_spec_versions_segment ON spec_versions;
CREATE TRIGGER trg_spec_versions_segment BEFORE INSERT ON spec_versions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_spec_versions_spec ON spec_versions(spec_id, version);

CREATE TABLE IF NOT EXISTS spec_audit_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  spec_id      UUID NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  spec_version INTEGER,
  section_id   VARCHAR(120),
  agent_role   VARCHAR(120),
  action       VARCHAR(64) NOT NULL,
  swimlane     VARCHAR(120),
  task_id      INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  detail       TEXT,
  at           TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_spec_audit_records_segment ON spec_audit_records;
CREATE TRIGGER trg_spec_audit_records_segment BEFORE INSERT ON spec_audit_records FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_spec_audit_spec ON spec_audit_records(spec_id, at);
CREATE INDEX IF NOT EXISTS idx_spec_audit_agent ON spec_audit_records(agent_role, at);
