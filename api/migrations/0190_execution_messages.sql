-- 0109_execution_messages.sql
-- Durable per-execution chat/steering thread. Until now a user "Send" on the
-- execution Output tab only forwarded to a live self-hosted host (and was a no-op
-- for cloud runs and for terminal runs). This table makes the steering thread a
-- first-class, cross-isolate, durable record so that:
--   • a steer to a RUNNING cloud agent (V1 / V2-durable / V2-container) is drained
--     into the agent loop on its next step (role='user', consumed_at IS NULL = pending),
--   • the thread survives a page reload (the optimistic WS echo was cross-isolate-
--     lossy and vanished on refresh),
--   • a follow-up to a TERMINAL run is recorded against the run it followed from.
-- consumed_at marks when the agent loop ingested a pending user steer (one-shot drain).
CREATE TABLE IF NOT EXISTS execution_messages (
  id            serial PRIMARY KEY,
  execution_id  integer     NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  tenant_id     integer     NOT NULL REFERENCES tenants(id),
  role          varchar(16) NOT NULL,           -- 'user' | 'assistant'
  text          text        NOT NULL,
  consumed_at   timestamp,                       -- NULL = pending steer the loop has not yet ingested
  created_at    timestamp   NOT NULL DEFAULT now()
);

-- Render the thread oldest-first for one execution.
CREATE INDEX IF NOT EXISTS idx_execution_messages_exec
  ON execution_messages (execution_id, created_at);

-- Hot path: the agent loop drains only the unconsumed user steers for its run.
CREATE INDEX IF NOT EXISTS idx_execution_messages_pending
  ON execution_messages (execution_id)
  WHERE consumed_at IS NULL;
