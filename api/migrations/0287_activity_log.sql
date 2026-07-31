-- Unified activity / audit log — the ONE canonical, append-only stream that
-- records every meaningful mutation in the system, attributed to ANY actor.
--
-- Motivation: activity was fragmented across ~8 purpose-built event tables
-- (activity_events for git, work_deltas for code, task_status_transitions for
-- lane moves, deployment_events, manager_actions, tool_audit_events, …) each
-- with its own actor convention. There was no single place to answer "who did
-- what, to what, when" across the whole workforce — team members, external
-- talent / hires, and AI agents alike. This table is that place.
--
-- Actor is polymorphic via (actor_type, actor_ref), following the existing
-- (kind, ref) convention (team_member_kind + task_status_transitions.actor_kind):
--   human       → users.id
--   hire        → users.id (external talent; engagement_id binds the cross-tenant
--                 relationship — freelancer_engagements.id)
--   cloud_agent → ide_agents.id (varchar; no FK, value-ref)
--   host_agent  → agent_hosts.id (integer, stringified)
--   system      → null (platform-initiated)
-- actor_name is denormalised so the timeline renders without a heterogeneous
-- fan-join across users / ide_agents / agent_hosts.
--
-- verb is free-form ('task.created', 'task.status_changed', 'comment.added',
-- 'deploy.recorded', 'role.assigned', …) so new event kinds need no migration.
CREATE TABLE IF NOT EXISTS activity_log (
  id            bigserial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    uuid REFERENCES segments(id) ON DELETE CASCADE,
  project_id    integer REFERENCES projects(id) ON DELETE SET NULL,
  actor_type    varchar(16) NOT NULL,          -- human | hire | cloud_agent | host_agent | system
  actor_ref     varchar(64),                   -- id into the per-type table (null for system)
  actor_name    varchar(255),                  -- denormalised display label
  engagement_id varchar(36),                   -- freelancer_engagements.id (hire scope; nullable)
  verb          varchar(64) NOT NULL,          -- 'task.created', 'comment.added', …
  target_type   varchar(32),                   -- 'task' | 'project' | 'deployment' | 'member' | …
  target_id     varchar(64),
  target_label  varchar(300),                  -- denormalised target label (e.g. ticket title)
  summary       text,                          -- human-readable one-liner
  metadata      jsonb,                          -- diff / details
  occurred_at   timestamp NOT NULL DEFAULT now(),
  created_at    timestamp NOT NULL DEFAULT now()
);

-- Tenant timeline (default sort). The workhorse index.
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_time
  ON activity_log(tenant_id, occurred_at DESC);
-- Per-actor drill-down (a person / agent's own trail).
CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON activity_log(tenant_id, actor_type, actor_ref, occurred_at DESC);
-- Per-target trail (everything that happened to one ticket / project).
CREATE INDEX IF NOT EXISTS idx_activity_log_target
  ON activity_log(tenant_id, target_type, target_id);
-- Per-project timeline.
CREATE INDEX IF NOT EXISTS idx_activity_log_project
  ON activity_log(tenant_id, project_id, occurred_at DESC);
