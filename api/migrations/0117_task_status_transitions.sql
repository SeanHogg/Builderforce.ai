-- 0117_task_status_transitions.sql
-- The KEYSTONE for ticket-lifecycle metrics. Until now completion was *proxied*
-- by tasks.updated_at landing in a done-class lane (see reportRoutes
-- generateCompletedByAssigneeReport) — which cannot express redo, idle-after-done,
-- time-in-status, or DORA cycle/lead time. One append-only row per lane move
-- unlocks all of them.
--
-- Emitted from PATCH /api/tasks/:id on every status change (sibling to the
-- existing audit_events insert). actor_kind/actor_ref record WHO moved it (a human
-- keeping the board honest, or an agent/system auto-advancing a lane).
--
-- is_backward is the redo signal: a move to a lower-ordinal swimlane (computed
-- from swimlanes.position at write time; null when the board can't be resolved).
-- The denormalized counters on tasks (redo_count / reopen_count) are bumped in the
-- same write so board reads never have to aggregate this log.
--
-- Idempotent / re-runnable: table IF NOT EXISTS, columns IF NOT EXISTS, backfill
-- guarded by NOT EXISTS so a re-run does not double-seed.

-- ── new lifecycle columns on tasks ───────────────────────────────────────────
-- completed_at: real timestamp the task entered a done-class lane (replaces the
--   updated_at proxy). Null once it leaves (reopen).
-- last_worked_at: the most recent "work stopped" signal (agent run terminal, or a
--   move OUT of an in-progress lane) — the baseline for idle-after-done.
-- redo_count / reopen_count: denormalized counters (see is_backward above).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_worked_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS redo_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reopen_count   INTEGER NOT NULL DEFAULT 0;

-- ── the transition log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_status_transitions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status VARCHAR(64),                       -- null = task creation
  to_status   VARCHAR(64) NOT NULL,
  actor_kind  VARCHAR(16) NOT NULL DEFAULT 'system',  -- 'human' | 'cloud_agent' | 'host_agent' | 'system'
  actor_ref   VARCHAR(64),                       -- users.id | ide_agents.id | agent_hosts.id | null
  is_backward BOOLEAN,                           -- true = moved to a lower-ordinal lane (redo); null = undetermined
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_task_status_transitions_segment ON task_status_transitions;
CREATE TRIGGER trg_task_status_transitions_segment BEFORE INSERT ON task_status_transitions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE task_status_transitions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE task_status_transitions ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tst_task     ON task_status_transitions(task_id);
CREATE INDEX IF NOT EXISTS idx_tst_tenant   ON task_status_transitions(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tst_project  ON task_status_transitions(project_id, occurred_at);

-- ── backfill ─────────────────────────────────────────────────────────────────
-- 1. Seed one genesis transition per existing task (null → current status) so the
--    log is never empty for a pre-existing board. occurred_at = updated_at (best
--    available signal). Guarded so re-running 0117 does not duplicate.
INSERT INTO task_status_transitions (tenant_id, segment_id, project_id, task_id, from_status, to_status, actor_kind, occurred_at)
SELECT p.tenant_id, t.segment_id, t.project_id, t.id, NULL, t.status, 'system', t.updated_at
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE NOT EXISTS (SELECT 1 FROM task_status_transitions x WHERE x.task_id = t.id);

-- 2. Backfill completed_at from the updated_at proxy for tasks already done.
UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;
