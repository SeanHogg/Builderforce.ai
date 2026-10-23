-- 1256 · A second, FREE vector space for `agent_memory` and `project_facts`
-- (PRD E3, cost lever `e3_free_embeddings`).
--
-- WHY. Memory is embedded with `openrouter/openai/text-embedding-3-small` into
-- `embedding vector(1536)` (1134). Every write and every recall query is a paid call,
-- and when the OpenRouter embedding key died (2026-10-10) every write in the window
-- went unembedded, because the only other embedder the platform has — Workers AI
-- bge-m3 on the account's own quota — answers 1024 dimensions and cannot share the
-- 1536 column (vectors from two models are not comparable; see memoryEmbedding.ts).
--
-- WHAT. A second column per store for the bge-m3 space, with its OWN model stamp
-- (a row can hold both vectors during the dual-read period, so `embedding_model`
-- cannot describe both) and an HNSW cosine index. The 1536 column is KEPT: recall
-- reads the 1024 column for rows that have it and falls back to the 1536 column for
-- rows that do not, each with a query vector from the matching model. The backfill
-- sweep fills `embedding_1024` for free; the lever then moves new writes onto it.
--
-- No `CREATE INDEX CONCURRENTLY`: the runner wraps each file in one transaction and
-- both tables are small (the same call 1134 made).

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedding_1024 vector(1024);
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedding_1024_model VARCHAR(64);
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedded_1024_at TIMESTAMPTZ;

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedding_1024 vector(1024);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedding_1024_model VARCHAR(64);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedded_1024_at TIMESTAMPTZ;

COMMENT ON COLUMN agent_memory.embedding_1024 IS 'bge-m3 (Workers AI, 1024-d) content embedding for ANN recall under e3_free_embeddings. NULL = not embedded in this space yet; recall falls back to `embedding`.';
COMMENT ON COLUMN agent_memory.embedding_1024_model IS 'Model that produced `embedding_1024`. The ANN read filters on it.';
COMMENT ON COLUMN project_facts.embedding_1024 IS 'bge-m3 (Workers AI, 1024-d) content embedding. NULL = not embedded in this space yet.';
COMMENT ON COLUMN project_facts.embedding_1024_model IS 'Model that produced `embedding_1024`.';

CREATE INDEX IF NOT EXISTS agent_memory_embedding_1024_hnsw
  ON agent_memory USING hnsw (embedding_1024 vector_cosine_ops);
CREATE INDEX IF NOT EXISTS project_facts_embedding_1024_hnsw
  ON project_facts USING hnsw (embedding_1024 vector_cosine_ops);

-- The 1024 backfill's keyset claim: "rows with no bge-m3 vector, by id".
CREATE INDEX IF NOT EXISTS agent_memory_unembedded_1024_idx
  ON agent_memory (id) WHERE embedding_1024 IS NULL;
CREATE INDEX IF NOT EXISTS project_facts_unembedded_1024_idx
  ON project_facts (id) WHERE embedding_1024 IS NULL;
