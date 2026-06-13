-- 0112_task_type_and_parent.sql
-- Task type/hierarchy foundation for Epic decomposition (gap [1251]).
--
-- A task is now typed (`task` default, or `epic`) and may carry a parent link
-- (`parent_task_id`, a nullable self-FK). This is the keystone of the "agents
-- are team members" model: when a task is assigned to an *agent*, a BA-style
-- agent can reclassify a vague "new item" into an Epic, decompose it into child
-- tasks, and fan-out-assign those children to humans/agents. The children point
-- back at the Epic via `parent_task_id`; the board reads the tree from there.
--
-- task_type is a plain enum (not free-form like status): the *type* is a fixed,
-- automation-driven dimension, whereas status is a per-board free-form lane key.
-- parent_task_id is ON DELETE SET NULL so deleting an Epic orphans (rather than
-- cascade-deletes) its children — the work survives the planning container.
--
-- Idempotent / re-runnable: enum create is guarded; columns use IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_type') THEN
    CREATE TYPE task_type AS ENUM ('task', 'epic');
  END IF;
END $$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type task_type NOT NULL DEFAULT 'task';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

-- Read path: the board fetches an Epic's children by parent_task_id.
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
