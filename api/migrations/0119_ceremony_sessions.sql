-- 0119_ceremony_sessions.sql
-- Persist & measure ceremonies (standup / planning round-table). Phase 1 was a live
-- view; this makes a ceremony an officially-started, timed session with per-person
-- turn durations, so standups and planning are tracked.
--
-- ONE table for both ceremony kinds (a `kind` column), mirroring the sprint/poker
-- session shape: tenant + segment scoped (segment via the set_default_segment_id()
-- trigger from 0056, same as 0114), UUID pk. A session owns its participants
-- (turn order + accrued speaking time). Standup turn-timer behaviour is configured
-- on the board and snapshotted onto the session at start.
--
-- Idempotent / re-runnable: CREATE TYPE-free (plain varchar kinds), tables use
-- IF NOT EXISTS, backfill precedes SET NOT NULL.

-- ── ceremony sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ceremony_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind            VARCHAR(16) NOT NULL,                       -- 'standup' | 'planning'
  status          VARCHAR(16) NOT NULL DEFAULT 'active',      -- 'active' | 'completed'
  facilitator_id  VARCHAR(64),                                -- users.id who started it
  turn_mode       VARCHAR(16) NOT NULL DEFAULT 'facilitator', -- snapshot of board.standup_turn_mode
  turn_seconds    INTEGER NOT NULL DEFAULT 90,                -- snapshot of board.standup_turn_seconds
  current_turn    INTEGER,                                    -- index into participants.turn_order
  turn_started_at TIMESTAMP,                                  -- when the current speaker began
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_ceremony_sessions_segment ON ceremony_sessions;
CREATE TRIGGER trg_ceremony_sessions_segment BEFORE INSERT ON ceremony_sessions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE ceremony_sessions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE ceremony_sessions ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ceremony_sessions_lookup ON ceremony_sessions(tenant_id, project_id, status);
-- At most one live session per board+kind (a project has one board).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ceremony_session_active ON ceremony_sessions(project_id, kind) WHERE status = 'active';

-- ── ceremony participants (turn order + accrued speaking time) ────────────────
CREATE TABLE IF NOT EXISTS ceremony_participants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES ceremony_sessions(id) ON DELETE CASCADE,
  member_kind  VARCHAR(16) NOT NULL,                          -- 'human' | 'cloud_agent' | 'host_agent'
  member_ref   VARCHAR(64) NOT NULL,
  member_name  VARCHAR(255) NOT NULL,
  turn_order   INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,                    -- accrued speaking time
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ceremony_participant UNIQUE (session_id, member_kind, member_ref)
);
DROP TRIGGER IF EXISTS trg_ceremony_participants_segment ON ceremony_participants;
CREATE TRIGGER trg_ceremony_participants_segment BEFORE INSERT ON ceremony_participants FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE ceremony_participants x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
ALTER TABLE ceremony_participants ALTER COLUMN segment_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ceremony_participants_session ON ceremony_participants(session_id);

-- ── board-level standup settings (drive the turn timer) ──────────────────────
ALTER TABLE boards ADD COLUMN IF NOT EXISTS standup_turn_mode    VARCHAR(16) NOT NULL DEFAULT 'facilitator'; -- 'facilitator' | 'timeboxed'
ALTER TABLE boards ADD COLUMN IF NOT EXISTS standup_turn_seconds INTEGER     NOT NULL DEFAULT 90;
