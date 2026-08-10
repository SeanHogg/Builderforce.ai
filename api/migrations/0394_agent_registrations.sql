-- Canonical, framework-neutral agent registry.
--
-- `agents` was the original callback-agent catalog. Its PostgreSQL enum can only
-- represent claude/openai/ollama/http and therefore cannot describe modern agent
-- runtimes or their wire protocols. It remains in place during the compatibility
-- window because historical skills, executions and dispatches reference it, but
-- all new registrations are written to `agent_registrations`.

CREATE TABLE IF NOT EXISTS agent_registrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id               UUID REFERENCES segments(id) ON DELETE CASCADE,
  agent_host_id            INTEGER REFERENCES agent_hosts(id) ON DELETE SET NULL,
  legacy_agent_id          INTEGER UNIQUE REFERENCES agents(id) ON DELETE SET NULL,
  name                     VARCHAR(255) NOT NULL,
  framework                VARCHAR(64) NOT NULL,
  protocol                 VARCHAR(32) NOT NULL,
  endpoint                 TEXT,
  external_agent_id        VARCHAR(255),
  credential_ref           VARCHAR(255),
  status                   VARCHAR(16) NOT NULL DEFAULT 'active',
  health_status            VARCHAR(16) NOT NULL DEFAULT 'unknown',
  declared_capabilities    JSONB NOT NULL DEFAULT '[]'::jsonb,
  discovered_capabilities  JSONB NOT NULL DEFAULT '[]'::jsonb,
  agent_card               JSONB,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  registered_by            VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at             TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_agent_registrations_protocol
    CHECK (protocol IN ('a2a', 'acp', 'builderforce-worker', 'native-http')),
  CONSTRAINT ck_agent_registrations_status
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_agent_registrations_health
    CHECK (health_status IN ('unknown', 'online', 'offline', 'degraded')),
  CONSTRAINT ck_agent_registrations_location
    CHECK (endpoint IS NOT NULL OR agent_host_id IS NOT NULL)
);

DROP TRIGGER IF EXISTS trg_agent_registrations_segment ON agent_registrations;
CREATE TRIGGER trg_agent_registrations_segment
  BEFORE INSERT ON agent_registrations
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_registrations_tenant_name
  ON agent_registrations(tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_agent_registrations_tenant_status
  ON agent_registrations(tenant_id, status, framework, protocol);
CREATE INDEX IF NOT EXISTS idx_agent_registrations_host
  ON agent_registrations(agent_host_id) WHERE agent_host_id IS NOT NULL;

-- Preserve existing integrations as canonical registrations. Skill names become
-- discovered capabilities; no legacy secret/hash is copied into the new model.
INSERT INTO agent_registrations (
  tenant_id, segment_id, legacy_agent_id, name, framework, protocol, endpoint,
  external_agent_id, status, health_status, discovered_capabilities, metadata,
  created_at, updated_at
)
SELECT
  a.tenant_id,
  a.segment_id,
  a.id,
  a.name,
  a.type::text,
  'native-http',
  a.endpoint,
  a.id::text,
  CASE WHEN a.is_active THEN 'active' ELSE 'inactive' END,
  'unknown',
  COALESCE(
    (SELECT jsonb_agg(DISTINCT s.name ORDER BY s.name) FROM skills s WHERE s.agent_id = a.id),
    '[]'::jsonb
  ),
  jsonb_build_object('migratedFrom', 'agents', 'legacyConfigPresent', a.config IS NOT NULL),
  a.created_at,
  a.updated_at
FROM agents a
ON CONFLICT (legacy_agent_id) DO NOTHING;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS agent_registration_id UUID
  REFERENCES agent_registrations(id) ON DELETE SET NULL;
ALTER TABLE agent_dispatches
  ADD COLUMN IF NOT EXISTS agent_registration_id UUID
  REFERENCES agent_registrations(id) ON DELETE SET NULL;

UPDATE executions e
SET agent_registration_id = r.id
FROM agent_registrations r
WHERE e.agent_id = r.legacy_agent_id
  AND e.agent_registration_id IS NULL;

UPDATE agent_dispatches d
SET agent_registration_id = r.id
FROM agent_registrations r
WHERE d.agent_id = r.legacy_agent_id
  AND d.agent_registration_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_executions_agent_registration
  ON executions(agent_registration_id);
CREATE INDEX IF NOT EXISTS idx_agent_dispatches_agent_registration
  ON agent_dispatches(agent_registration_id);

COMMENT ON TABLE agents IS
  'DEPRECATED: historical callback-agent catalog. New writes use agent_registrations.';
COMMENT ON COLUMN executions.agent_id IS
  'DEPRECATED compatibility reference; use agent_registration_id for new executions.';
COMMENT ON COLUMN agent_dispatches.agent_id IS
  'DEPRECATED compatibility reference; use agent_registration_id for new dispatches.';
