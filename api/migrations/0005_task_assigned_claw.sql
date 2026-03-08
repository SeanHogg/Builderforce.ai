-- Add explicit task → claw assignment for dispatch and HITL routing.
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS assigned_claw_id INTEGER REFERENCES coderclaw_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_assigned_claw_idx ON tasks (assigned_claw_id);