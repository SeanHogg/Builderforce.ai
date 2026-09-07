-- 1135 · `tenant_skills` — a workspace's own skills, including ones its agents wrote.
--
-- WHY. Skills existed in two stores and neither could be written by an agent.
-- `marketplace_skills` is the public catalogue: its `author_id` is a foreign key to
-- `users`, its only INSERT sits behind a browser session, and its rows carry no
-- tenant at all — a marketplace JWT is issued with `tid: 0`. The bundled SKILL.md
-- directories are files in the runtime image. So a run that worked out a repeatable
-- procedure had nowhere to put it, and the next run rediscovered it.
--
-- A board run that reaches Done with graded proof HAS executed a procedure that
-- worked. This table is where that procedure lands: workspace-scoped, authored by a
-- run rather than a person, and inert until a human approves it. `status` is the
-- whole safety story — a draft is injected into nobody's prompt, so an agent
-- proposing a skill can never change what another agent is told to do.
--
-- `origin_execution_id` and `origin_task_id` are plain integers with no foreign key,
-- like `tool_audit_events.execution_id`: they cross a domain boundary, and a
-- cascade from a deleted run would erase the provenance of an approved procedure —
-- the one column that answers "where did this instruction come from".

CREATE TABLE IF NOT EXISTS tenant_skills (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          INTEGER,
  slug                VARCHAR(255) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT NOT NULL,
  body                TEXT NOT NULL,
  -- draft → approved (usable) | rejected (kept, so the same proposal is not re-made).
  status              VARCHAR(16) NOT NULL DEFAULT 'draft',
  -- 'agent' when a run proposed it, 'human' when a person wrote it here.
  author_kind         VARCHAR(16) NOT NULL DEFAULT 'agent',
  author_label        VARCHAR(255),
  evidence            TEXT,
  origin_execution_id INTEGER,
  origin_task_id      INTEGER,
  reviewed_by         VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One skill per slug per workspace: a re-proposal REVISES the draft rather than
-- accumulating near-duplicates, which is what makes `skill_propose` idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_skills_slug ON tenant_skills(tenant_id, slug);
-- The two live reads: the review queue (status) and the prompt injection (approved).
CREATE INDEX IF NOT EXISTS tenant_skills_status_idx ON tenant_skills(tenant_id, status, updated_at DESC);

COMMENT ON COLUMN tenant_skills.status IS 'draft | approved | rejected. Only approved rows reach an agent prompt — an agent-authored draft is inert until a human approves it.';
COMMENT ON COLUMN tenant_skills.origin_execution_id IS 'Run that proposed the skill. Deliberately no FK: a deleted run must not erase the provenance of an approved procedure.';
