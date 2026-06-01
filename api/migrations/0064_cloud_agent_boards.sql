-- Migration: Cloud Agent Boards — agentic swimlanes (Slice 1).
-- Boards fan a project's backlog into ordered swimlanes; each lane has 1..N
-- agents (parallel|sequential). Autonomous boards auto-advance a ticket on
-- stage success; on failure the ticket goes to a needs-attention lane and does
-- NOT silently advance. ticket_runs is the per-ticket lifecycle state machine.
-- Segment-scoped via the 0056 set_default_segment_id() trigger.

CREATE TABLE IF NOT EXISTS boards (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id             UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id             INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                   VARCHAR(255) NOT NULL,
  autonomous             BOOLEAN NOT NULL DEFAULT FALSE,
  max_concurrent_tickets INTEGER NOT NULL DEFAULT 5,
  needs_attention_lane   VARCHAR(120) NOT NULL DEFAULT 'needs-attention',
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_boards_segment ON boards;
CREATE TRIGGER trg_boards_segment BEFORE INSERT ON boards FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_boards_segment ON boards(tenant_id, segment_id, project_id);

CREATE TABLE IF NOT EXISTS swimlanes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  board_id       UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  key            VARCHAR(120) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  is_terminal    BOOLEAN NOT NULL DEFAULT FALSE,
  gate           VARCHAR(16) NOT NULL DEFAULT 'auto',
  execution_mode VARCHAR(16) NOT NULL DEFAULT 'sequential',
  failure_policy VARCHAR(24) NOT NULL DEFAULT 'needs_attention',
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_swimlane_board_key UNIQUE (board_id, key)
);
DROP TRIGGER IF EXISTS trg_swimlanes_segment ON swimlanes;
CREATE TRIGGER trg_swimlanes_segment BEFORE INSERT ON swimlanes FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_swimlanes_board ON swimlanes(board_id, position);

CREATE TABLE IF NOT EXISTS swimlane_agent_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id            UUID REFERENCES segments(id) ON DELETE CASCADE,
  swimlane_id           UUID NOT NULL REFERENCES swimlanes(id) ON DELETE CASCADE,
  role                  VARCHAR(120) NOT NULL,
  runtime               VARCHAR(16) NOT NULL DEFAULT 'cloud',
  target                VARCHAR(120),
  task_template         TEXT,
  required_capabilities TEXT,
  model                 VARCHAR(120),
  position              INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_swimlane_agent_assignments_segment ON swimlane_agent_assignments;
CREATE TRIGGER trg_swimlane_agent_assignments_segment BEFORE INSERT ON swimlane_agent_assignments FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_swimlane_assignments_lane ON swimlane_agent_assignments(swimlane_id, position);

CREATE TABLE IF NOT EXISTS ticket_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  board_id            UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id             INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  current_swimlane_id UUID REFERENCES swimlanes(id) ON DELETE SET NULL,
  lifecycle           VARCHAR(24) NOT NULL DEFAULT 'queued',
  current_workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  stage_history       TEXT,
  branch_name         VARCHAR(255),
  error               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ticket_run_board_task UNIQUE (board_id, task_id)
);
DROP TRIGGER IF EXISTS trg_ticket_runs_segment ON ticket_runs;
CREATE TRIGGER trg_ticket_runs_segment BEFORE INSERT ON ticket_runs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_ticket_runs_board ON ticket_runs(board_id, lifecycle);

CREATE TABLE IF NOT EXISTS swimlane_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_run_id   UUID NOT NULL REFERENCES ticket_runs(id) ON DELETE CASCADE,
  from_swimlane_id UUID REFERENCES swimlanes(id) ON DELETE SET NULL,
  to_swimlane_id  UUID REFERENCES swimlanes(id) ON DELETE SET NULL,
  reason          VARCHAR(32) NOT NULL,
  workflow_status VARCHAR(16),
  detail          TEXT,
  at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swimlane_transitions_run ON swimlane_transitions(ticket_run_id, at);
