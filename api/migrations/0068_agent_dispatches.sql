-- Migration: Runtime-agnostic agent dispatch (Slice 5).
-- One row per agent execution unit for a swimlane stage. The executor may be a
-- claw (push via CLAW_RELAY), a cloud worker, or a BROWSER pull worker that
-- claims pending rows, runs the agent loop with the user's own model, and posts
-- the result back. When every dispatch in a stage (ticket_run_id, swimlane_id,
-- stage_seq) is terminal, the SwimlaneCoordinator advances the ticket
-- (autonomous mode) or routes it to needs-attention. This is what makes
-- "agents run, including in the browser, with autonomous advancement" real.

CREATE TABLE IF NOT EXISTS agent_dispatches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  ticket_run_id UUID NOT NULL REFERENCES ticket_runs(id) ON DELETE CASCADE,
  swimlane_id   UUID REFERENCES swimlanes(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES swimlane_agent_assignments(id) ON DELETE SET NULL,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id      INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  stage_seq     INTEGER NOT NULL DEFAULT 0,
  role          VARCHAR(120) NOT NULL,
  runtime       VARCHAR(16) NOT NULL DEFAULT 'cloud',
  target        VARCHAR(120),
  model         VARCHAR(160),
  input         TEXT,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  output        TEXT,
  error         TEXT,
  depends_on    TEXT,
  external_ref  VARCHAR(128),
  position      INTEGER NOT NULL DEFAULT 0,
  claimed_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_agent_dispatches_segment ON agent_dispatches;
CREATE TRIGGER trg_agent_dispatches_segment BEFORE INSERT ON agent_dispatches FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
-- Browser pull workers claim the oldest pending browser dispatch for their tenant.
CREATE INDEX IF NOT EXISTS idx_agent_dispatches_claim ON agent_dispatches(tenant_id, runtime, status, created_at);
-- Stage aggregation: all dispatches for one stage of a ticket.
CREATE INDEX IF NOT EXISTS idx_agent_dispatches_stage ON agent_dispatches(ticket_run_id, stage_seq);
