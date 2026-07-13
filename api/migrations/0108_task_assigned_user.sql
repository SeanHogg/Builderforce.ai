-- 0108_task_assigned_user.sql
-- Humans and agents are one team: a task's assignee/owner can be a human
-- (users.id) just as it can be a self-hosted host or a cloud agent. Nullable +
-- ON DELETE SET NULL so removing a user un-assigns their tasks rather than
-- cascade-deleting the work. A task is owned by EITHER a human OR an agent
-- (host / cloud ref) — the mutual exclusion is enforced at the write boundary,
-- not by a DB constraint (the three id-spaces are disjoint).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL;
