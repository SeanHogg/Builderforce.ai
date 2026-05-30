-- 0053_llm_traces.sql
-- Full per-call diagnostic trace for every BuilderLLM gateway request.
--
-- One row per LLM call (chat or image), keyed by an authoritative `trace_id`
-- (`llm-<uuid>`) that the gateway generates and returns to the consumer in the
-- response body (`_builderforce.traceId`), the `x-builderforce-trace-id`
-- response header, and (on failure) `error.details.correlationId`. A superadmin
-- can paste the trace id into /admin to pull up everything about the call:
-- who made it, how long it ran, every model attempt, every exception, the
-- candidate chain, and the request/response bodies.
--
-- Rows are written fire-and-forget (ctx.waitUntil) so tracing never adds latency
-- to or fails the request. A 30-day purge runs in the Worker's scheduled() cron.

CREATE TABLE IF NOT EXISTS llm_traces (
  id                  SERIAL PRIMARY KEY,
  trace_id            VARCHAR(48)  NOT NULL UNIQUE,
  -- Requester identity (whichever auth path applied).
  tenant_id           INTEGER      REFERENCES tenants(id) ON DELETE SET NULL,
  user_id             VARCHAR(36),
  claw_id             INTEGER,
  tenant_api_key_id   UUID,
  -- Routing context.
  llm_product         VARCHAR(32),
  surface             VARCHAR(16)  NOT NULL DEFAULT 'chat',  -- chat | image | ide-chat | brain | dataset-gen | agent
  effective_plan      VARCHAR(8),
  premium_override    BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Outcome.
  resolved_model      VARCHAR(200),
  resolved_vendor     VARCHAR(32),
  status              INTEGER,                                -- final HTTP status returned to caller
  success             BOOLEAN      NOT NULL DEFAULT FALSE,
  outcome             VARCHAR(32),                            -- success | cascade_exhausted | all_cooldown | subrequest_exhausted | strict_unavailable | schema_nonconforming
  classification      VARCHAR(16),                            -- rate_limit | timeout | auth | server_error | mixed | none
  attempt_count       INTEGER      NOT NULL DEFAULT 0,
  retries             INTEGER      NOT NULL DEFAULT 0,
  schema_retries      INTEGER      NOT NULL DEFAULT 0,
  duration_ms         INTEGER      NOT NULL DEFAULT 0,        -- total gateway time
  -- Token accounting.
  prompt_tokens       INTEGER      NOT NULL DEFAULT 0,
  completion_tokens   INTEGER      NOT NULL DEFAULT 0,
  total_tokens        INTEGER      NOT NULL DEFAULT 0,
  -- Caller-supplied trace-back.
  use_case            VARCHAR(128),
  idempotency_key     VARCHAR(128),
  consumer_request_id VARCHAR(128),                           -- caller's own x-request-id / x-correlation-id
  request_ip          VARCHAR(64),
  origin              VARCHAR(255),
  user_agent          TEXT,
  streamed            BOOLEAN      NOT NULL DEFAULT FALSE,
  error_message       TEXT,
  -- Detail blobs (JSON stored as text per this schema's column convention).
  request_shape       TEXT,                                   -- { hasTools, hasVision, hasStructuredOutput, hasOcr, messageCount, modelHint, modelStrict, temperature, maxTokens }
  candidate_chain     TEXT,                                   -- ["cerebras/llama-3.3-70b", ...]
  attempts            TEXT,                                   -- [{ model, vendor, status, kind, durationMs, error }]
  request_body        TEXT,                                   -- full messages, secrets redacted
  response_body       TEXT,                                   -- final completion or error envelope
  caller_metadata     TEXT,
  created_at          TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_traces_tenant_created_idx ON llm_traces (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_traces_created_idx        ON llm_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS llm_traces_model_idx          ON llm_traces (resolved_model);
CREATE INDEX IF NOT EXISTS llm_traces_consumer_req_idx   ON llm_traces (consumer_request_id);
