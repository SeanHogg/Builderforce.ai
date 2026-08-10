-- Move the legacy team-memory feed into the governed tenant memory scope.
INSERT INTO agent_memory (tenant_id, key, content, tags, importance, scope_kind, scope_id, origin, created_at, updated_at)
SELECT tm.tenant_id, 'team:' || tm.agent_host_id || ':' || tm.run_id, tm.summary, tm.tags,
       0.5, 'tenant', 0, 'on-prem', tm.created_at, tm.created_at
FROM team_memory tm
ON CONFLICT (tenant_id, scope_kind, scope_id, key) DO UPDATE SET
  content = EXCLUDED.content, tags = EXCLUDED.tags, origin = EXCLUDED.origin,
  expires_at = NULL, updated_at = EXCLUDED.updated_at;

ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS origin VARCHAR(64) NOT NULL DEFAULT 'ingestion';
ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
UPDATE agent_knowledge_chunks c SET tenant_id = a.tenant_id FROM ide_agents a WHERE a.id = c.agent_id AND c.tenant_id IS NULL;
DELETE FROM agent_knowledge_chunks WHERE tenant_id IS NULL;
ALTER TABLE agent_knowledge_chunks ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks_tenant_agent ON agent_knowledge_chunks(tenant_id, agent_id, ordinal);
