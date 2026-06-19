-- Cloud agent memory: a durable key→fact store for Worker/DO (and Container) agents,
-- scoped per tenant. Backs the shared `memory` capability (memory_recall /
-- memory_remember tools) on the cloud surface — the Worker-safe twin of the on-prem
-- SSM MemoryStore. Recall is lexical (Postgres ILIKE over content/key); on-prem stays
-- semantic (SSM embeddings). `(tenant_id, key)` is unique so remember() upserts.
CREATE TABLE IF NOT EXISTS agent_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         varchar(255) NOT NULL,
  content     text NOT NULL,
  tags        text NOT NULL DEFAULT '[]',
  importance  real NOT NULL DEFAULT 0.5,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_tenant_key_uniq ON agent_memory (tenant_id, key);
CREATE INDEX IF NOT EXISTS agent_memory_tenant_idx ON agent_memory (tenant_id);
