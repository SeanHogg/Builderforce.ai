-- 1075_task_plan_verdicts.sql
-- The planner's VERDICT on an Epic's plan: does it fit, and is it a DAG?
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `scheduleItems` has always reported `compressed`, `overruns` and `cyclic`, and
-- `TaskService.decomposeEpic` has always computed them — and then dropped them on
-- the floor. Only the AI Manager's SCHEDULE pass wrote anything down, and only
-- the cycle count. So an Epic whose children had to be squeezed to fit its due
-- date looked exactly like one that planned cleanly, and an Epic whose children
-- sit in a dependency cycle (where the planner's ordering is a guess, not a plan)
-- looked exactly like one that did not. The PM found out when the date slipped.
--
-- ── WHY STORED, NOT DERIVED ─────────────────────────────────────────────────
-- Overruns and cycles could be re-derived from `tasks` + `task_dependencies`.
-- COMPRESSION cannot: once estimates have been scaled down to fit a due date the
-- resulting windows fit perfectly, and nothing left in `tasks` says they were
-- ever squeezed. Splitting the verdict — one half stored, one half re-derived —
-- would give two readers two ways to disagree, so the whole verdict lands here,
-- written by the one path that produced it.
--
-- ── ONE ROW PER PARENT ──────────────────────────────────────────────────────
-- A re-plan REPLACES the verdict (upsert on task_id). An old verdict about a plan
-- that no longer exists is worse than no verdict: it is a warning a PM cannot
-- act on, attached to work that has already changed shape.

CREATE TABLE IF NOT EXISTS task_plan_verdicts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The PARENT whose plan this judges (an Epic).
  task_id     integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- Estimates were scaled DOWN to fit the parent's window.
  compressed  boolean NOT NULL DEFAULT false,
  -- Child task ids that still end after the parent's due date.
  overrun_task_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Child task ids caught in a precedence cycle — their order is a guess.
  cyclic_task_ids            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Child task ids whose start was pushed out by their owner's capacity.
  capacity_deferred_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which reasoning step produced the plan being judged: llm | heuristic | manual.
  source      varchar(16),
  planned_at  timestamp NOT NULL DEFAULT now(),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- One verdict per parent — the write is an upsert on this key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_plan_verdicts_task
  ON task_plan_verdicts (task_id);

-- The read the planning spine and the manager census do: every verdict in a
-- project, so a run of misfitting plans reads as one picture rather than N rows.
CREATE INDEX IF NOT EXISTS idx_task_plan_verdicts_project
  ON task_plan_verdicts (tenant_id, project_id);
