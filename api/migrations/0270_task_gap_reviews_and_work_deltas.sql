-- 0270_task_gap_reviews_and_work_deltas.sql
-- Three coupled pieces behind "delta → ticket" visibility and the Validator agent.
--
--   1. task_type gains a third value 'gap'. A GAP task is NOT authored by a human
--      or spawned from an Epic — it is minted by the Validator agent when it
--      reviews a Done item against the codebase and finds the work incomplete.
--      It is a first-class board item so the gap is visible and schedulable.
--
--   2. Review bookkeeping on tasks + a task_reviews ledger. A Done item can be
--      reviewed MANY times (on entry to Done, then re-swept on a schedule), so we
--      keep the full history in task_reviews and denormalise the latest pass onto
--      the task (review_count / last_reviewed_at / last_review_verdict) for cheap
--      board rendering. gap_origin_task_id ties a GAP task back to the Done item
--      whose review produced it.
--
--   3. work_deltas — the provenance ledger for "a chat turn changed code". Every
--      modality (VS Code, web Brain, MCP, CLI, cloud agent) records a delta here
--      when its work produces a code change; the delta is classified
--      improvement|fix|bug and (optionally) tied to the ticket it created. This is
--      what gives the operator visibility of ad-hoc "just start typing" work that
--      previously landed silently.
--
-- Idempotent / re-runnable: ADD VALUE + CREATE TABLE IF NOT EXISTS + ADD COLUMN
-- IF NOT EXISTS. 'gap' is only ADDED here (never used as a literal in this file),
-- so it is safe inside the migration runner's single-file transaction.

-- 1. GAP task type ----------------------------------------------------------
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'gap';

-- 2. Review bookkeeping on tasks + the review ledger -------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_count        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_reviewed_at    TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_review_verdict VARCHAR(16);   -- 'complete' | 'gaps'
-- For a GAP task: the Done item whose review produced it (null for task/epic).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS gap_origin_task_id  INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_reviews (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id      INTEGER NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
  -- ide_agents.id of the Validator that ran the pass (or 'system' for automation).
  reviewer_ref VARCHAR(64),
  -- Outcome of the pass: 'complete' (nothing missing) | 'gaps' (GAP tasks minted).
  verdict      VARCHAR(16) NOT NULL,
  summary      TEXT,
  gaps_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- "review history for this task", newest first (ticket drawer + re-sweep guard).
CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_reviews_tenant ON task_reviews(tenant_id, created_at DESC);
-- Board rollup: find GAP tasks born from a given Done item.
CREATE INDEX IF NOT EXISTS idx_tasks_gap_origin ON tasks(gap_origin_task_id);

-- 3. Work-delta provenance ledger -------------------------------------------
CREATE TABLE IF NOT EXISTS work_deltas (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- The ticket this delta created/updated (null if it could not be created).
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  -- The Brain chat/session that produced the delta, for lineage (null for headless).
  chat_id     INTEGER REFERENCES ide_project_chats(id) ON DELETE SET NULL,
  -- Interaction surface that produced it: 'ide' | 'web' | 'mcp' | 'cli' | 'cloud'.
  modality    VARCHAR(32) NOT NULL DEFAULT 'unknown',
  -- Classification of the change: 'improvement' | 'fix' | 'bug'.
  kind        VARCHAR(16) NOT NULL,
  summary     TEXT NOT NULL,
  detail      TEXT,
  -- Files touched by the change (string[]), for the delta drawer + insight surfaces.
  files       JSONB,
  -- User id or agent ref that authored the turn.
  created_by  VARCHAR(64),
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Insight surfaces group deltas by (tenant, project) over time and by kind.
CREATE INDEX IF NOT EXISTS idx_work_deltas_tenant_project ON work_deltas(tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_deltas_task ON work_deltas(task_id);
