-- 0335 — Coordinated Role Participation, Phase 3–5
-- (PRD-coordinated-role-participation.md): ticket-type-scoped requirements + quorum
-- + condition, the lifecycle-managed board flag (Coordinator = Assignee, executor
-- decoupling), and the incident→implicated-delivery-ticket edge for RCA linkage.
-- All additive / idempotent.

-- ── Ticket-type scope + quorum + condition on requirement rows ───────────────
-- ticket_type NULL = applies to all types. quorum NULL = all required rows of that
-- kind at the stage must be met (N-of-M when set). condition = a small enum predicate.
ALTER TABLE swimlane_requirements
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS quorum      INTEGER,
  ADD COLUMN IF NOT EXISTS condition   VARCHAR(48);

ALTER TABLE kanban_template_lane_requirements
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS quorum      INTEGER,
  ADD COLUMN IF NOT EXISTS condition   VARCHAR(48);

-- ── Lifecycle-managed boards (Coordinator = Assignee; §5.5) ──────────────────
-- When true, the ticket's Assignee is the COORDINATOR and is never the default
-- per-stage executor — the per-stage producer is resolved by role capability and
-- the assignee→executor owner-fallback is suppressed. Default false = legacy.
ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS lifecycle_managed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Incident → implicated delivery ticket(s) (§5.10 RCA linkage) ─────────────
-- The delivery ticket(s) whose change caused an incident, so RCA can pull their
-- Accountability Reports and see where the process was skipped/waived.
CREATE TABLE IF NOT EXISTS prod_incident_implicated_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES prod_incidents(id) ON DELETE CASCADE,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relation    VARCHAR(24) NOT NULL DEFAULT 'implicated', -- implicated | suspected | ruled_out
  note        TEXT,
  created_by  VARCHAR(36),
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_incident_implicated_task
  ON prod_incident_implicated_tasks(incident_id, task_id);
CREATE INDEX IF NOT EXISTS idx_incident_implicated_incident ON prod_incident_implicated_tasks(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_implicated_tenant ON prod_incident_implicated_tasks(tenant_id);
