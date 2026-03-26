-- Phase 3: Local LLM inference pipeline — LoRA adapter caching, Mamba state sync, inference logging.

ALTER TABLE ide_agents
  ADD COLUMN IF NOT EXISTS package_version TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS mamba_state     JSONB,
  ADD COLUMN IF NOT EXISTS inference_mode  TEXT NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS request_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at    TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS agent_inference_logs (
  id                TEXT        PRIMARY KEY,
  agent_id          TEXT        NOT NULL REFERENCES ide_agents(id) ON DELETE CASCADE,
  model_ref         TEXT        NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  latency_ms        INTEGER,
  status            TEXT        NOT NULL,
  error_message     TEXT,
  inference_mode    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_inference_logs_agent_id_idx ON agent_inference_logs(agent_id);
CREATE INDEX IF NOT EXISTS agent_inference_logs_created_at_idx ON agent_inference_logs(created_at DESC);
