-- 0114_workforce_teams.sql
-- Workforce Teams — group the workforce (agents AND humans) into named teams and
-- attach a team to one or more projects.
--
-- This is the WORKFORCE team model (Workforce → Teams tab), distinct from the
-- contributor-analytics `dev_teams` cluster (0068a): dev_teams members are
-- `contributors` (a GitHub/identity-reconciliation profile used for standup/DORA
-- analytics), whereas a workforce team member is a first-class *assignable* entity
-- — a human (users.id) OR an agent (a cloud agent's ide_agents.id, or a remote
-- agent_hosts.id). The membership identity therefore mirrors the task-assignee
-- model (tasks.assigned_user_id / assigned_agent_ref / assigned_agent_host_id):
-- humans and agents are one team.
--
-- A workforce entity can belong to MANY teams (member_kind+member_ref is unique
-- per team, not globally), and a team can be attached to MANY projects.
--
-- segment_id + trigger follow the established tenant-scoped pattern (see 0068a):
-- set_default_segment_id() (added in 0056) auto-fills the workspace's default
-- segment so single-segment tenants need no change. Junction tables inherit
-- scoping through their team_id FK and carry no segment_id of their own (same as
-- dev_team_members).
--
-- Idempotent / re-runnable: CREATE TYPE is guarded, tables use IF NOT EXISTS,
-- backfill precedes SET NOT NULL.

-- ── member kind: which workforce sub-population the ref points at ────────────
DO $$ BEGIN
  CREATE TYPE team_member_kind AS ENUM ('human', 'cloud_agent', 'host_agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── teams ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_teams_segment ON teams;
CREATE TRIGGER trg_teams_segment BEFORE INSERT ON teams FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE teams x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE teams ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_tenant  ON teams(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teams_segment ON teams(segment_id);

-- ── team members (polymorphic: human | cloud_agent | host_agent) ─────────────
-- member_ref is the stringified identity in the relevant table (users.id /
-- ide_agents.id / agent_hosts.id). No FK — the three target tables are
-- heterogeneous (one is a raw-SQL table), so referential integrity is enforced in
-- the route. member_name is denormalized for display so the list view never has
-- to fan-join across all three populations; it is refreshed on (re-)add.
CREATE TABLE IF NOT EXISTS team_members (
  id           SERIAL PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_kind  team_member_kind NOT NULL,
  member_ref   VARCHAR(64) NOT NULL,
  member_name  VARCHAR(255) NOT NULL,
  added_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_member UNIQUE (team_id, member_kind, member_ref)
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

-- ── team ↔ project attachment (M:N) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_projects (
  id         SERIAL PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_project UNIQUE (team_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_team_projects_team    ON team_projects(team_id);
CREATE INDEX IF NOT EXISTS idx_team_projects_project ON team_projects(project_id);
