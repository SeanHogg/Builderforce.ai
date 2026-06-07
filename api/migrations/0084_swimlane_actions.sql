-- Migration: Swimlane lane actions, success quorum & registry-backed agent
-- assignments.
--
-- A lane now declares an ACTION that fires once its agents settle per a SUCCESS
-- POLICY:
--   action_type      NULL|'advance'  → advance to the next lane (legacy default)
--                    'move_ticket'   → move the ticket to action_target (a lane key)
--                    'run_workflow'  → run the workflow definition action_target, then advance
--   success_policy   'all'  → every dispatch must complete (legacy behaviour)
--                    'any'  → at least one completing fires the action
--                    'n_of_m' → success_threshold completions fire the action
--
-- Agent assignments are now picked from the tenant's registered/workforce agent
-- registry. agent_kind+agent_ref record which registry agent was chosen; the
-- existing role/runtime/target/model columns hold the values resolved from that
-- agent at assign time (so the dispatch pipeline is unchanged).

ALTER TABLE swimlanes
  ADD COLUMN IF NOT EXISTS action_type       VARCHAR(16),
  ADD COLUMN IF NOT EXISTS action_target     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS success_policy    VARCHAR(16) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS success_threshold INTEGER;

ALTER TABLE swimlane_agent_assignments
  ADD COLUMN IF NOT EXISTS agent_kind VARCHAR(16),  -- 'workforce' | 'registered'
  ADD COLUMN IF NOT EXISTS agent_ref  VARCHAR(64),  -- ide_agents.id | agents.id
  ADD COLUMN IF NOT EXISTS name       VARCHAR(255); -- display name of the chosen agent
