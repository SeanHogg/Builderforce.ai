-- LLM usage log: one row per completed request through the CoderClawLLM proxy
CREATE TABLE IF NOT EXISTS llm_usage_log (
  id                SERIAL PRIMARY KEY,
  model             VARCHAR(200) NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  retries           INTEGER NOT NULL DEFAULT 0,
  streamed          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_model      ON llm_usage_log (model);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_log (created_at DESC);
