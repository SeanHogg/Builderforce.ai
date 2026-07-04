-- Ticket role/diagnostic audit — pillar 1 of the Agentic Workforce Kanban.
--
-- "Visualize and audit each ticket to make sure all the key roles and diagnostics
--  were performed on it; if not, flag it for review." This is part of the Manager
-- AI agent's diagnostic. We record explicit ROLE SIGN-OFFS as work happens, then
-- compute per-ticket coverage against the lane requirements (migration 0274) and
-- flag any ticket missing a required role / diagnostic / review.
--
-- Reuses the shape of the existing Validator ledger (task_reviews, migration 0270)
-- and the manager_actions 'flag' audit feed rather than inventing a parallel model.

-- 1) Role sign-offs: an append-only ledger of "a member acting AS role R
--    approved / requested-changes on ticket T at lane L". Written by the Architect
--    review round-trip, the Validator, code review, QA, etc. The audit engine reads
--    this to decide whether a lane's required role/review requirement was satisfied.
CREATE TABLE IF NOT EXISTS ticket_role_signoffs (
  id           varchar(36) PRIMARY KEY,
  tenant_id    integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id      integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lane_key     varchar(120),                 -- the lane the sign-off was made against
  role_key     varchar(60) NOT NULL,         -- job role slug (built-in or custom)
  member_kind  varchar(16),                  -- human | cloud_agent | host_agent
  member_ref   varchar(64),                  -- users.id | ide_agents.id | agent_hosts.id
  verdict      varchar(20) NOT NULL DEFAULT 'approved',   -- approved | changes_requested
  summary      text,
  created_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_signoffs_task ON ticket_role_signoffs(task_id);
CREATE INDEX IF NOT EXISTS idx_role_signoffs_task_role ON ticket_role_signoffs(task_id, role_key);

-- 2) Computed audit result per ticket (upserted). One row per task — the latest
--    coverage verdict the board badge + Manager diagnostic surface. `missing` is a
--    JSON array of unmet requirements: [{ laneKey, kind, ref, responsibility, reason }].
CREATE TABLE IF NOT EXISTS ticket_audits (
  task_id         integer PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_id        uuid REFERENCES boards(id) ON DELETE SET NULL,
  status          varchar(12) NOT NULL DEFAULT 'pass',   -- pass | flagged
  coverage        integer NOT NULL DEFAULT 100,          -- 0..100 % of required checks satisfied
  required_count  integer NOT NULL DEFAULT 0,
  satisfied_count integer NOT NULL DEFAULT 0,
  missing         text,                                  -- JSON array of unmet requirements
  computed_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_audits_tenant_status ON ticket_audits(tenant_id, status);

-- 3) Denormalise the audit verdict onto the task so the board renders a flag chip
--    without a join (mirrors tasks.review_count / last_review_verdict from 0270).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS audit_status     varchar(12);  -- null(unaudited) | pass | flagged
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS audit_flag_count integer NOT NULL DEFAULT 0;

-- 4) Let a diagnostic run be scoped to a single ticket (audit checks kind='diagnostic'
--    by looking for a tool_run on this task). tool_runs previously scoped to project only.
ALTER TABLE tool_runs ADD COLUMN IF NOT EXISTS task_id integer REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tool_runs_task ON tool_runs(task_id) WHERE task_id IS NOT NULL;
