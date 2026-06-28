-- 0226_allocation_and_goals.sql
-- Categorical investment-allocation tracking (the signature Jellyfish lens) +
-- allocation goal-setting + the capex/opex cost split that rides the same axis.
--
-- 1. tasks.allocation_category — the INVESTMENT axis (innovation | ktlo | support |
--    tech_debt | other), orthogonal to the existing action_type (the TECHNICAL
--    axis). Derived for free from action_type + task signals (no LLM call, no
--    workflow change); a PM can override (allocation_category_source = 'manual').
--    Null = unclassified → the rollup DERIVES it on the fly so every historical
--    task counts immediately with zero backfill (the column is just the cache /
--    override). Pairs with cost_class (0225) for capitalizable-cost reporting.
--
-- 2. allocation_goals — desired investment mix per scope (tenant | team | project)
--    per month per category (e.g. "30% innovation"). The allocation lens compares
--    target_pct to the measured actual and surfaces the variance. tenant+segment
--    scoped (uuid PK) like the other planning trackers, so the generic
--    segmentTrackerRoutes factory drives its CRUD. Idempotent / re-runnable.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS allocation_category        varchar(16),
  ADD COLUMN IF NOT EXISTS allocation_category_source varchar(12) NOT NULL DEFAULT 'derived'; -- derived | manual | agent

CREATE INDEX IF NOT EXISTS idx_tasks_allocation_category
  ON tasks(allocation_category) WHERE allocation_category IS NOT NULL;

-- ── Allocation goals (desired investment mix) ────────────────────────────────
CREATE TABLE IF NOT EXISTS allocation_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  scope_kind    VARCHAR(16) NOT NULL DEFAULT 'tenant',   -- tenant | team | project
  team_id       INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  period_month  VARCHAR(7) NOT NULL,                     -- 'YYYY-MM'
  category      VARCHAR(16) NOT NULL,                    -- innovation | ktlo | support | tech_debt | other
  target_pct    REAL NOT NULL DEFAULT 0,                 -- desired share of effort (0..100)
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_allocation_goals_scope
  ON allocation_goals(tenant_id, segment_id, period_month);
-- One target per (scope, period, category).
CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_goals_target
  ON allocation_goals(tenant_id, scope_kind, COALESCE(team_id, 0), COALESCE(project_id, 0), period_month, category);

DROP TRIGGER IF EXISTS trg_allocation_goals_segment ON allocation_goals;
CREATE TRIGGER trg_allocation_goals_segment
  BEFORE INSERT ON allocation_goals
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();
