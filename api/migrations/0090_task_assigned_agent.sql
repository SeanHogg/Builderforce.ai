-- 0090_task_assigned_agent.sql
-- Agents are first-class assignees: when a cloud agent starts working a ticket it
-- self-assigns, recorded here as the ide_agents.id of the executing agent.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_agent_ref text;
