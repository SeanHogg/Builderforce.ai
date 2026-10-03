-- 0013 · Agent-run telemetry moves from core to the operational endpoint.
--
-- WHY. Neon bills each project's compute by its own awake time, so tables are grouped
-- by WHEN they are written, not by subject. Everything below is written while an agent
-- runs — the same moments `llm_usage_log` is written, on an endpoint that is already
-- awake for it. Left on core, every run kept core awake as well (`tool_audit_events`
-- alone took ~77k writes between two of core's sleeps), paying for the same minutes in
-- two projects.
--
-- THE SET:
--   tool_audit_events  + tool_audit_daily        the per-call trail and its daily fold
--   execution_claims   + execution_claim_evidence the completion claims that cite trail
--                                                  rows — written at run finish, and the
--                                                  attach trigger below must see the trail
--                                                  in the SAME database to stay atomic
--   usage_snapshots, brain_chat_trace, run_context_state, run_model_outcomes
--
-- References to core entities (tenants, segments, projects, tasks, executions, agent
-- hosts, brain chats) are plain scalar ids: Postgres cannot enforce a key across Neon
-- projects. The cascades those keys used to perform are done by
-- `src/infrastructure/database/siblingCascade.ts`. References WITHIN this set keep
-- their keys (claim → evidence → trail).
--
-- The core copies are not dropped here — core's migration track never touches this
-- endpoint and vice versa. `scripts/copy-run-telemetry.mjs` copies the existing rows
-- across (ids preserved, so claim evidence keeps pointing at the right trail rows) and
-- can empty the core copies afterwards; until then the retention sweep drains them,
-- since `sweptTables.ts` declares the swept members on both endpoints.

CREATE TABLE IF NOT EXISTS tool_audit_events (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, segment_id uuid,
  agent_host_id integer, cloud_agent_ref varchar(64), execution_id integer,
  run_id varchar(255), session_key varchar(255), tool_call_id varchar(255),
  tool_name varchar(255) NOT NULL, category varchar(100), args text, result text,
  duration_ms integer, ts timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_audit_events_segment ON tool_audit_events (segment_id);
CREATE INDEX IF NOT EXISTS idx_tool_audit_cloud_agent ON tool_audit_events (tenant_id, cloud_agent_ref, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_audit_execution ON tool_audit_events (execution_id);
-- The lifecycle ledger's "latest auto-run decision per ticket" and the retention sweep's
-- day windows both scan by tenant + session/time; core relied on the two above alone.
CREATE INDEX IF NOT EXISTS idx_tool_audit_session ON tool_audit_events (tenant_id, session_key, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_audit_ts ON tool_audit_events (ts);

CREATE TABLE IF NOT EXISTS tool_audit_daily (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, day date NOT NULL,
  tool_name varchar(255) NOT NULL, category varchar(100), agent_host_id integer,
  cloud_agent_ref varchar(64), events integer NOT NULL, distinct_executions integer NOT NULL,
  duration_ms_total bigint, first_ts timestamp NOT NULL, last_ts timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_audit_daily_grain
  ON tool_audit_daily (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_tool_audit_daily_tenant_day ON tool_audit_daily (tenant_id, day);

CREATE TABLE IF NOT EXISTS execution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id integer NOT NULL,
  execution_id integer NOT NULL, kind varchar(32) NOT NULL, statement text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_execution_claims_execution ON execution_claims (tenant_id, execution_id, created_at);

CREATE TABLE IF NOT EXISTS execution_claim_evidence (
  claim_id uuid NOT NULL REFERENCES execution_claims(id) ON DELETE CASCADE,
  tool_audit_event_id integer NOT NULL REFERENCES tool_audit_events(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, tool_audit_event_id)
);
CREATE INDEX IF NOT EXISTS idx_execution_claim_evidence_event ON execution_claim_evidence (tenant_id, tool_audit_event_id);

-- The evidence contract, verbatim from core's 0443: attach the qualifying trail rows in
-- the statement that creates the claim, and reject a claim nothing supports.
CREATE OR REPLACE FUNCTION attach_execution_claim_evidence() RETURNS TRIGGER AS $$
DECLARE attached INTEGER;
BEGIN
  INSERT INTO execution_claim_evidence (claim_id, tool_audit_event_id, tenant_id)
  SELECT NEW.id, e.id, NEW.tenant_id FROM tool_audit_events e
   WHERE e.tenant_id = NEW.tenant_id AND e.execution_id = NEW.execution_id
     AND (
       (NEW.kind = 'code_completion' AND e.category = 'tool' AND e.tool_name ~ '^(write_file|edit_file|delete_file|run_checks|run_command|git_)') OR
       (NEW.kind = 'validation' AND e.category = 'tool' AND e.tool_name ~ '^(run_checks|run_command)$') OR
       (NEW.kind = 'review_verdict' AND e.category = 'tool' AND e.tool_name = 'builtin_reviews_record') OR
       (NEW.kind = 'delivery' AND e.category = 'tool' AND e.tool_name IN ('pr_opened','pr_merged')) OR
       (NEW.kind = 'human_message' AND e.category = 'message' AND e.tool_name = 'agent.message')
     )
     AND COALESCE(LOWER(e.result), '') NOT LIKE '%"ok":false%'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '%failed%'
     AND COALESCE(LOWER(e.result), '') NOT LIKE 'blocked %'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '% refused%';
  GET DIAGNOSTICS attached = ROW_COUNT;
  IF attached = 0 THEN RAISE EXCEPTION '% claim requires qualifying successful evidence', NEW.kind; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_claim_attach_evidence ON execution_claims;
CREATE TRIGGER trg_execution_claim_attach_evidence
AFTER INSERT ON execution_claims
FOR EACH ROW EXECUTE FUNCTION attach_execution_claim_evidence();

CREATE OR REPLACE FUNCTION reject_execution_claim_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'execution claims and evidence are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_claims_immutable ON execution_claims;
CREATE TRIGGER trg_execution_claims_immutable
BEFORE UPDATE OR DELETE ON execution_claims
FOR EACH ROW EXECUTE FUNCTION reject_execution_claim_mutation();

DROP TRIGGER IF EXISTS trg_execution_claim_evidence_immutable ON execution_claim_evidence;
CREATE TRIGGER trg_execution_claim_evidence_immutable
BEFORE UPDATE OR DELETE ON execution_claim_evidence
FOR EACH ROW EXECUTE FUNCTION reject_execution_claim_mutation();

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, segment_id uuid,
  agent_host_id integer, cloud_agent_ref varchar(64), execution_id integer,
  session_key varchar(255) NOT NULL, input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0, context_tokens integer NOT NULL DEFAULT 0,
  context_window_max integer NOT NULL DEFAULT 0, compaction_count integer NOT NULL DEFAULT 0,
  ts timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_segment ON usage_snapshots (segment_id);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_cloud_agent ON usage_snapshots (tenant_id, cloud_agent_ref, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_execution ON usage_snapshots (execution_id);
-- The agent-host telemetry reads ("this host's snapshots, newest first").
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_host ON usage_snapshots (tenant_id, agent_host_id, ts DESC);

-- `tenant_id` is new with the move (core gets it in 1191): with no key into
-- `brain_chats` the row can no longer inherit its tenant through the chat, and the
-- tenant-erasure cascade needs to find it. NULL only on rows copied from before 1191.
CREATE TABLE IF NOT EXISTS brain_chat_trace (
  id serial PRIMARY KEY, chat_id integer NOT NULL, tenant_id integer, turn_seq integer,
  kind varchar(24) NOT NULL, label varchar(120), args_json text, result_json text,
  is_error boolean NOT NULL DEFAULT false, duration_ms integer, ttft_ms integer,
  occurred_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brain_chat_trace_chat ON brain_chat_trace (chat_id, id);
CREATE INDEX IF NOT EXISTS idx_brain_chat_trace_tenant ON brain_chat_trace (tenant_id);

CREATE TABLE IF NOT EXISTS run_context_state (
  id bigserial PRIMARY KEY, tenant_id integer NOT NULL, scope varchar(160) NOT NULL,
  subject_key varchar(512) NOT NULL, content text NOT NULL,
  importance real NOT NULL DEFAULT 0.6, created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_context_state_subject ON run_context_state (tenant_id, scope, subject_key);
CREATE INDEX IF NOT EXISTS idx_run_context_state_scope ON run_context_state (tenant_id, scope, updated_at);

CREATE TABLE IF NOT EXISTS run_model_outcomes (
  id serial PRIMARY KEY, tenant_id integer, project_id integer, task_id integer,
  execution_id integer, source varchar(16) NOT NULL DEFAULT 'cloud',
  client_run_id varchar(128), cloud_agent_ref varchar(64),
  action_type varchar(32) NOT NULL DEFAULT 'other', role varchar(16),
  resolved_model varchar(200) NOT NULL, plan varchar(16) NOT NULL, score real NOT NULL,
  merged boolean NOT NULL DEFAULT false, ci_green boolean NOT NULL DEFAULT false,
  degraded boolean NOT NULL DEFAULT false, steps integer NOT NULL DEFAULT 0,
  cost_usd_millicents integer NOT NULL DEFAULT 0, terminal_status varchar(16) NOT NULL,
  rate_limited boolean NOT NULL DEFAULT false, tool_calls integer, tool_errors integer,
  human_rejected boolean, faithfulness real, answer_relevance real,
  hallucination_rate real, eval_method varchar(8),
  created_at timestamp NOT NULL DEFAULT now()
);
-- Backs the scorer's `onConflictDoNothing({ target: execution_id })`.
CREATE UNIQUE INDEX IF NOT EXISTS run_model_outcomes_execution_id_key ON run_model_outcomes (execution_id);
-- Backs the client-run upsert on `client_run_id` (cloud rows are NULL and never collide).
CREATE UNIQUE INDEX IF NOT EXISTS run_model_outcomes_client_run_id_key
  ON run_model_outcomes (client_run_id) WHERE client_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_model_outcomes_scope_idx ON run_model_outcomes (tenant_id, action_type, plan);
CREATE INDEX IF NOT EXISTS run_model_outcomes_source_idx ON run_model_outcomes (tenant_id, source, action_type);
CREATE INDEX IF NOT EXISTS idx_run_model_outcomes_project_created ON run_model_outcomes (project_id, created_at);
-- Every insights lens reads one tenant over a recent window.
CREATE INDEX IF NOT EXISTS idx_run_model_outcomes_tenant_created ON run_model_outcomes (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_outcomes_eval
  ON run_model_outcomes (action_type, resolved_model, created_at) WHERE faithfulness IS NOT NULL;

-- Per-table autovacuum tuning for the retention-swept members, as core's 1104 / 1125 /
-- 1130 set it — required on THIS endpoint by `npm run check:swept-tables`.
ALTER TABLE tool_audit_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE brain_chat_trace  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                   autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE tool_audit_daily  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                                   fillfactor = 85);

-- ID FLOOR. A push to main runs this migration and deploys the Worker in one job, so new
-- rows land here BEFORE `scripts/copy-run-telemetry.mjs` brings core's history across.
-- Starting every sequence far above any core id makes that order safe: copied rows keep
-- their own (lower) ids and can never collide with rows written here first. Never moves
-- a sequence backwards; 500M leaves ~1.6B of int headroom.
SELECT setval(pg_get_serial_sequence(t, 'id'), GREATEST(500000000, (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = t || '_id_seq')), true)
  FROM unnest(ARRAY['tool_audit_events', 'tool_audit_daily', 'usage_snapshots', 'brain_chat_trace', 'run_context_state', 'run_model_outcomes']) AS t;
