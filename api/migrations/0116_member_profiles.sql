-- 0116_member_profiles.sql
-- Capability & availability profile for every workforce member — humans AND
-- agents — so the AI sprint planner can decide WHO gets WHAT and WHEN.
--
-- Keyed by the same polymorphic identity as team_members / the task-assignee model
-- (member_kind + member_ref → users.id | ide_agents.id | agent_hosts.id). One
-- profile per member per tenant. No FK on member_ref (the three target tables are
-- heterogeneous, one is raw-SQL) — referential integrity is enforced in the route,
-- exactly as team_members (0114) does.
--
-- Agents get a profile too: capacity / skills / focus give the planner symmetry
-- (it load-balances a human and a cloud agent with the same arithmetic). Schedule
-- fields (work_hours / timezone / pto) are only meaningful for humans but are
-- harmless nulls on agents.
--
-- sync_source is the Calendar-ready seam: 'manual' today; a later integration can
-- flip a profile to 'google_calendar' and overlay busy/pto blocks WITHOUT a
-- migration (the work_hours / pto JSON shape already carries them).
--
-- Idempotent / re-runnable: CREATE TYPE guarded, table IF NOT EXISTS.

-- ── experience level: routes difficulty + weights redo expectations ──────────
DO $$ BEGIN
  CREATE TYPE member_experience_level AS ENUM ('junior', 'mid', 'senior', 'staff', 'principal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── real-time availability override (sits ON TOP of the work_hours schedule) ──
DO $$ BEGIN
  CREATE TYPE member_availability_status AS ENUM ('available', 'busy', 'focus', 'ooo', 'on_call');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── where the schedule/pto data is maintained (Calendar-ready seam) ──────────
DO $$ BEGIN
  CREATE TYPE member_profile_sync_source AS ENUM ('manual', 'google_calendar');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS member_profiles (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- polymorphic identity (reuses the team_member_kind enum from 0114)
  member_kind   team_member_kind NOT NULL,
  member_ref    VARCHAR(64) NOT NULL,

  -- ── scheduling (human-centric; harmless nulls on agents) ──────────────────
  timezone      VARCHAR(64),                 -- IANA, e.g. 'America/New_York'; anchors all "working now?" math
  work_hours    JSONB,                       -- per-weekday ranges: {"mon":[["09:00","17:00"]], ...} — supports split shifts / days off
  pto           JSONB,                       -- [{"from":"2026-07-01","to":"2026-07-05","reason":"vacation"}]
  response_sla_hours       REAL,             -- expected time to pick up an assigned ticket (feeds pickup-latency engagement)

  -- ── capacity (both populations; planner load-balances on these) ───────────
  weekly_capacity_hours    REAL,
  daily_capacity_points    REAL,
  max_concurrent_wip       INTEGER,          -- WIP ceiling — prevents over-assignment / thrash
  ramp_factor   REAL NOT NULL DEFAULT 1.0,   -- 0..1 — new hire / returning-from-leave gets less load

  -- ── routing inputs ────────────────────────────────────────────────────────
  experience_level         member_experience_level,
  skills        JSONB,                       -- [{"tag":"react","proficiency":4}, ...] — match to task persona/labels
  focus_areas   JSONB,                       -- repo / project / domain affinities — keep owners on familiar code (lowers redo)
  preferred_task_types     JSONB,            -- ["frontend","bugfix"] — morale + throughput

  -- ── real-time state (overrides the schedule) ──────────────────────────────
  availability_status      member_availability_status NOT NULL DEFAULT 'available',
  availability_until       TIMESTAMP,        -- when the manual status reverts to schedule-derived
  last_active_at           TIMESTAMP,        -- heartbeat so "available" isn't a lie (parallel to agent_hosts.last_seen_at)

  -- ── economics (optional; lets the planner weigh human-vs-agent cost) ──────
  cost_rate_usd_cents      INTEGER,          -- blended hourly cost; null = not modelled

  -- ── provenance ────────────────────────────────────────────────────────────
  sync_source   member_profile_sync_source NOT NULL DEFAULT 'manual',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_member_profile UNIQUE (tenant_id, member_kind, member_ref)
);

DROP TRIGGER IF EXISTS trg_member_profiles_segment ON member_profiles;
CREATE TRIGGER trg_member_profiles_segment BEFORE INSERT ON member_profiles FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE member_profiles x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE member_profiles ALTER COLUMN segment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_profiles_tenant  ON member_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_segment ON member_profiles(segment_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_member  ON member_profiles(member_kind, member_ref);
