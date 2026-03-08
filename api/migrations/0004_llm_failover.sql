-- Track individual model failover attempts for observability.
-- Each row = one model that was tried and failed before a successful response
-- (or before all models were exhausted).
-- error_code: HTTP status (402, 429, 503, etc.) or 0 for body/stream errors.

CREATE TABLE IF NOT EXISTS llm_failover_log (
  id         SERIAL PRIMARY KEY,
  model      VARCHAR(200) NOT NULL,
  error_code INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_failover_model_idx   ON llm_failover_log (model);
CREATE INDEX IF NOT EXISTS llm_failover_created_idx ON llm_failover_log (created_at DESC)
