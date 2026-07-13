-- 0265_ai_manager.sql
-- The AI Manager coordination layer.
--
-- A designated manager (an AI agent OR a human) — and, by default, a tenant-wide
-- system service — reviews each project's board every tick and does the judgement
-- work the mechanical autonomous sweep cannot: it scores each ticket's BUSINESS
-- VALUE (0-100 + rationale, AI-scored or RICE-derived), RANKS the backlog by
-- priority × value × due-date urgency, ASSIGNS unowned work to the best-fit
-- teammate/agent, and drives finished tickets through PR merge/close per policy.
--
-- Three additions:
--   1. tasks: business_value + rationale + source, and manager_rank (the computed
--      backlog order the priority-aware dispatcher and board read consume).
--   2. project_manager_configs: per-project manager designation + policy (overrides
--      the default-on system service). NULL manager_ref = the system service runs it.
--   3. manager_actions: an audit feed of every decision the manager took, so the
--      Manager surface can show "what did the manager do and why" to humans.

-- 1. Per-ticket business value + the manager's computed rank ------------------
ALTER TABLE tasks
  -- 0-100 business-value score. NULL = unscored (the manager backfills it).
  ADD COLUMN IF NOT EXISTS business_value          INTEGER,
  -- One-line human-readable justification for the score (shown on the card/drawer).
  ADD COLUMN IF NOT EXISTS business_value_rationale TEXT,
  -- Who/what set the score: 'ai' (LLM-scored) | 'rice' (PMO RICE-derived) | 'manual'.
  ADD COLUMN IF NOT EXISTS business_value_source    VARCHAR(12),
  -- The manager's computed backlog rank (1 = work this first). NULL = unranked.
  -- Consumed by the priority-aware autonomous dispatcher + the board default sort.
  ADD COLUMN IF NOT EXISTS manager_rank             INTEGER;

-- Rank scan: the dispatcher pulls a project's runnable tickets in rank order.
CREATE INDEX IF NOT EXISTS idx_tasks_manager_rank
  ON tasks(project_id, manager_rank);

-- 2. Per-project manager designation + policy --------------------------------
CREATE TABLE IF NOT EXISTS project_manager_configs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The designated manager, assignee-encoded ('u:<userId>' human | 'c:<ref>' cloud
  -- agent | 'h:<hostId>' host agent). NULL = the default-on tenant system service
  -- manages this project (no explicit designation). The human/agent split mirrors
  -- task ownership so "a manager" is the same concept a human manager fills.
  manager_ref         TEXT,
  -- Master switch for THIS project. When false the manager skips the project
  -- entirely (no grooming / ranking / assignment / PR coordination).
  enabled             BOOLEAN NOT NULL DEFAULT true,
  -- PR authority: 'immediate' (merge+close as soon as the agent finishes),
  -- 'on_green' (merge only after CI passes), 'queue' (never merge — surface for a
  -- human to approve). Tenant default is 'immediate'.
  pr_merge_policy     VARCHAR(12) NOT NULL DEFAULT 'immediate',
  -- Assign unowned, unstaffed tickets to the best-fit teammate/agent.
  auto_assign         BOOLEAN NOT NULL DEFAULT true,
  -- Backfill business value on tickets that lack it.
  auto_business_value BOOLEAN NOT NULL DEFAULT true,
  -- Recompute manager_rank across the backlog.
  auto_prioritize     BOOLEAN NOT NULL DEFAULT true,
  -- Last time the manager pass ran for this project (observability + cadence).
  last_run_at         TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_manager_configs_project
  ON project_manager_configs(tenant_id, project_id);

-- 3. Manager decision audit feed ---------------------------------------------
CREATE TABLE IF NOT EXISTS manager_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The ticket the action was about (NULL for project-wide actions like a re-rank).
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  -- 'prioritize' | 'assign' | 'score_value' | 'dispatch' | 'merge_pr' | 'close_pr' | 'flag'.
  action_type VARCHAR(24) NOT NULL,
  -- Human-readable one-liner shown in the Manager activity feed.
  summary     TEXT NOT NULL,
  -- Structured JSON payload (scores, chosen assignee, PR number, …) for drill-in.
  detail      TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Newest-first feed per project.
CREATE INDEX IF NOT EXISTS idx_manager_actions_feed
  ON manager_actions(tenant_id, project_id, created_at DESC);
