-- 1134 · `agent_memory` and `project_facts` get real semantic retrieval.
--
-- WHY. `memory_recall` has never done semantic retrieval on the cloud path. With
-- no embedding key it runs an ILIKE over the content; WITH one it does something
-- worse — it drops the query predicate entirely, pulls a ~10-row window ordered by
-- `importance, updated_at`, and re-ranks THAT with embeddings. A relevant memory
-- outside the window is unreachable, and the surface most responsible for "recall
-- what we already know" is the one that cannot find it. Meanwhile genuine semantic
-- recall is proven twice elsewhere in the product: Evermind's hidden-state ring and
-- the on-prem store's sqlite-vec + FTS5 fusion.
--
-- WHAT. A `vector` column per store plus an HNSW cosine index, so recall becomes a
-- real ANN query fused with the lexical arm (the shared 0.7/0.3 formula in
-- `@builderforce/agent-tools`, the same one on-prem ranks with).
--
-- `CREATE EXTENSION` in a migration is refused elsewhere in this repo
-- (`1094_extension_directory_and_review_stages.sql`, `catalogSearch.ts`) and that
-- refusal stands for `pg_trgm`, which needs a superuser on most hosts. `vector` is
-- different: Neon allowlists it for the ordinary role, which is the only reason
-- this is a one-line DDL rather than an infrastructure request. `IF NOT EXISTS`
-- keeps it idempotent, and every column below degrades to "not embedded yet" if
-- the extension were somehow absent — recall falls back to the lexical arm.
--
-- DIMENSION. Embeddings are pinned to ONE model per store rather than left to the
-- vendor cascade: the cascade fails over between a 2048-d and a 512-d model, and a
-- fixed-width column (which HNSW requires) cannot hold both. `embedding_model`
-- records which model produced the vector, and the ANN read filters on it, so a
-- later model change re-embeds through the backfill sweep instead of silently
-- comparing vectors from two different spaces.
--
-- No `CREATE INDEX CONCURRENTLY`: the migration runner wraps each file in one
-- transaction, and both tables are small.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(64);
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(64);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

COMMENT ON COLUMN agent_memory.embedding IS 'Content embedding for ANN recall. NULL = not embedded yet (the backfill sweep fills it); recall still answers from the lexical arm.';
COMMENT ON COLUMN agent_memory.embedding_model IS 'Model that produced `embedding`. The ANN read filters on it so vectors from two model generations are never compared.';
COMMENT ON COLUMN project_facts.embedding IS 'Content embedding for ANN recall. NULL = not embedded yet.';
COMMENT ON COLUMN project_facts.embedding_model IS 'Model that produced `embedding`.';

-- HNSW over cosine distance: recall orders by `embedding <=> query`, and cosine is
-- the metric the embedding models are trained for (and what the on-prem arm uses).
CREATE INDEX IF NOT EXISTS agent_memory_embedding_hnsw
  ON agent_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS project_facts_embedding_hnsw
  ON project_facts USING hnsw (embedding vector_cosine_ops);

-- The backfill sweep's claim query: "rows in this tenant with no vector yet".
CREATE INDEX IF NOT EXISTS agent_memory_unembedded_idx
  ON agent_memory (tenant_id, updated_at) WHERE embedding IS NULL;
CREATE INDEX IF NOT EXISTS project_facts_unembedded_idx
  ON project_facts (tenant_id, updated_at) WHERE embedding IS NULL;
