-- 0225_planning_spine.sql
-- One connected planning spine across the four levels (objective → initiative →
-- epic → task): every level is dated, lineage-linked, and cost-bearing, with a
-- CAPEX/OPEX classification that inherits down and is reconciled by PMs.
--
-- 1. Real timeline bounds on objectives & initiatives so every level draws on the
--    SAME Gantt. `objectives.period` stays as a derived label.
-- 2. cost_class (capex|opex) + cost_class_source (inherited|manual|agent) on every
--    work-bearing level; tasks additionally carry cost_class_verified for the PM
--    reconciliation stage.
-- 3. tasks.initiative_id — the missing lineage edge so a task/epic rolls up to an
--    initiative (and through it to a portfolio) without faking it via the project join.
-- 4. objective_links — an objective owns any mix of initiatives, epics, or tasks
--    ("an OKR can have multiple Epics or a task").

ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS start_date timestamp,
  ADD COLUMN IF NOT EXISTS end_date timestamp,
  ADD COLUMN IF NOT EXISTS cost_class varchar(8),
  ADD COLUMN IF NOT EXISTS cost_class_source varchar(12) NOT NULL DEFAULT 'manual';

ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS start_date timestamp,
  ADD COLUMN IF NOT EXISTS cost_class varchar(8),
  ADD COLUMN IF NOT EXISTS cost_class_source varchar(12) NOT NULL DEFAULT 'manual';

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS cost_class varchar(8),
  ADD COLUMN IF NOT EXISTS cost_class_source varchar(12) NOT NULL DEFAULT 'manual';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS initiative_id uuid REFERENCES initiatives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_class varchar(8),
  ADD COLUMN IF NOT EXISTS cost_class_source varchar(12) NOT NULL DEFAULT 'inherited',
  ADD COLUMN IF NOT EXISTS cost_class_verified boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_initiative ON tasks(initiative_id);

CREATE TABLE IF NOT EXISTS objective_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    uuid REFERENCES segments(id) ON DELETE CASCADE,
  objective_id  uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  link_kind     varchar(12) NOT NULL,           -- 'initiative' | 'epic' | 'task'
  initiative_id uuid REFERENCES initiatives(id) ON DELETE CASCADE,
  task_id       integer REFERENCES tasks(id) ON DELETE CASCADE,
  created_at    timestamp NOT NULL DEFAULT now()
);

-- One link per (objective, target) — a target is an initiative OR a task/epic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_objective_links_initiative
  ON objective_links(objective_id, initiative_id) WHERE initiative_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_objective_links_task
  ON objective_links(objective_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objective_links_objective ON objective_links(objective_id);
