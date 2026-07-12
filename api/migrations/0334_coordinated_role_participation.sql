-- 0334 — Coordinated Role Participation & Execution Verification
-- (PRD-coordinated-role-participation.md, Phases 1–2 + resource-assessment + child-task rollup).
--
-- Closes the #467 root cause (role-blind assignment) and lays the accountability
-- record: a per-ticket participation manifest, an enriched append-only sign-off
-- ledger (Who / When / Verdict / Comments / Contribution), and first-class agent↔role
-- capability so a PM agent is never dispatched to write code.
--
-- All additive / idempotent.

-- ── Phase 1: first-class agent role capability ──────────────────────────────
-- Explicit role keys an agent can act as (JSON string[]). NULL/absent falls back
-- to builtin_kind-derived + fuzzy title/skill matching (roleCapability.ts).
ALTER TABLE ide_agents
  ADD COLUMN IF NOT EXISTS role_keys JSONB;

-- ── Phase 2: enrich the accountability ledger (append-only) ─────────────────
-- The sign-off row is the accountability record of truth. Widen it to carry the
-- resolved signer identity name, the verifiable contribution link, and a waive
-- reason. verdict widens (varchar, no enum) to approved|changes_requested|waived|delegated.
ALTER TABLE ticket_role_signoffs
  ADD COLUMN IF NOT EXISTS member_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contribution JSONB,
  ADD COLUMN IF NOT EXISTS waive_reason TEXT;

-- ── Phase 2: the per-ticket Participation Manifest ──────────────────────────
-- The forward-looking, stateful roster of who MUST participate on a ticket, who
-- has, and with what evidence. Derived from the applicable process template and
-- kept live; the Resource Assessment step ADDS rows (source='assessment'), so the
-- manifest is dynamic, not purely template-derived. Each row may materialize as a
-- child task (child_task_id) so the parent ticket's %-complete rolls up from them.
CREATE TABLE IF NOT EXISTS ticket_participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  stage_key      VARCHAR(120),                        -- lane/stage this participation belongs to
  role_key       VARCHAR(120) NOT NULL,               -- required role
  responsibility VARCHAR(16) NOT NULL DEFAULT 'owner', -- owner | reviewer | contributor
  required       BOOLEAN NOT NULL DEFAULT TRUE,
  source         VARCHAR(16) NOT NULL DEFAULT 'template', -- template | assessment | manual
  assignee_kind  VARCHAR(16),                         -- agent | human | hire | null (unresolved)
  assignee_ref   VARCHAR(128),                        -- resolved concrete participant (or null)
  assignee_name  VARCHAR(255),
  state          VARCHAR(24) NOT NULL DEFAULT 'pending', -- pending|assigned|in_progress|completed|changes_requested|waived|skipped|unstaffed
  signoff_id     VARCHAR(36) REFERENCES ticket_role_signoffs(id) ON DELETE SET NULL,
  child_task_id  INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  evidence       JSONB,                               -- { prUrl?, diffFiles?, testRunId?, diagnosticToolId?, executionId? }
  quorum_group   VARCHAR(160),                        -- rows sharing this key form a quorum set
  note           TEXT,                                -- assessment rationale / gap reason
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- One manifest row per (task, stage, role, responsibility, source) — lets derive be
-- idempotent (re-derive upserts) while still allowing an assessment-added duplicate role.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_ticket_participants_slot
  ON ticket_participants(task_id, stage_key, role_key, responsibility, source);
CREATE INDEX IF NOT EXISTS idx_ticket_participants_task ON ticket_participants(task_id);
CREATE INDEX IF NOT EXISTS idx_ticket_participants_tenant ON ticket_participants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ticket_participants_child ON ticket_participants(child_task_id);
