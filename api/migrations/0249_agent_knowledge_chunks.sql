-- Agent knowledge chunks — proprietary documents ingested for a published
-- Workforce agent, chunked for retrieval. Recalled (BM25) at inference time and
-- injected as grounded context via the AgentSpec `memory.recalledContext` field
-- (the compile primitive, PRD-agent-compile-primitive.md Phase C3). Raw-SQL table
-- mirroring `ide_agents` (no Drizzle schema.ts entry, like the other ide_* tables).
CREATE TABLE IF NOT EXISTS agent_knowledge_chunks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ide_agents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks_agent ON agent_knowledge_chunks(agent_id);
