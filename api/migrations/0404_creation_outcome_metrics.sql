-- Correlated, scope-aware value telemetry for Creation Sessions.
-- This is intentionally separate from revision events: revision events rebuild
-- canvas state, while outcome events answer whether an action generated value.

CREATE TABLE IF NOT EXISTS creation_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id varchar(128) NOT NULL,
  session_id uuid NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  actor_type varchar(16) NOT NULL DEFAULT 'user',
  actor_ref varchar(128),
  action varchar(64) NOT NULL,
  phase varchar(16) NOT NULL,
  metric_key varchar(80),
  metric_value real,
  unit varchar(24),
  artifact_id varchar(128),
  duration_ms integer,
  cost_usd_millicents integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT creation_outcome_phase_check CHECK (phase IN ('started', 'succeeded', 'failed', 'validated', 'reused')),
  CONSTRAINT creation_outcome_actor_check CHECK (actor_type IN ('user', 'agent', 'brain', 'system')),
  CONSTRAINT creation_outcome_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT creation_outcome_cost_check CHECK (cost_usd_millicents IS NULL OR cost_usd_millicents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_creation_outcomes_session_time ON creation_outcome_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_creation_outcomes_project_time ON creation_outcome_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_creation_outcomes_tenant_time ON creation_outcome_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_creation_outcomes_correlation ON creation_outcome_events(session_id, correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_creation_outcomes_correlation_phase
  ON creation_outcome_events(session_id, correlation_id, action, phase);
