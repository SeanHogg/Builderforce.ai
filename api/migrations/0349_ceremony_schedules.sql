-- Migration: Ceremony schedules — make standups / plannings run themselves.
--
-- Before this, a ceremony only existed if a human clicked "start" (POST
-- /api/agile/ceremonies/sessions). There was no cadence: the "standup" that ran
-- on a schedule was the *digest email* (report_schedules), not an actual
-- ceremony. This table is the missing scheduler surface — the frequent (*/5)
-- cron sweep (runDueCeremonies) opens a ceremony_sessions row with its roster
-- pre-seeded for every enabled schedule whose next_run_at has elapsed, then
-- re-arms next_run_at from the cron expression.
--
-- Cadence representation is deliberately IDENTICAL to qa_schedules /
-- workflow_triggers (5-field cron + IANA timezone, evaluated by
-- domain/workflowSchedule.nextCronTime) rather than a second day-of-week+time
-- encoding. One cadence language across every scheduled subsystem.
--
-- `kind` matches ceremony_sessions.kind exactly (standup | planning). Retros are
-- NOT modelled here: they are their own subsystem (retrospectives / retro_items)
-- with a different lifecycle, and folding them in would fork the taxonomy.
--
-- Participant scoping: 'members' seeds the roster from the project's active
-- members (ordered by the existing member-metrics readers, so the quietest
-- speak first); 'roster' seeds it from the explicit participants JSON captured
-- on the schedule. Either way the seeded rows are ordinary ceremony_participants,
-- so computeCeremonyRollup and the live CeremonyRoomDO need no changes.

CREATE TABLE IF NOT EXISTS ceremony_schedules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID         REFERENCES segments(id) ON DELETE CASCADE,
  project_id        INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Mirrors ceremony_sessions.kind: 'standup' | 'planning'.
  kind              VARCHAR(16)  NOT NULL DEFAULT 'standup',
  cron              VARCHAR(120) NOT NULL,
  timezone          VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  enabled           BOOLEAN      NOT NULL DEFAULT true,
  -- Turn settings stamped onto the auto-opened session (null = inherit the board's).
  turn_mode         VARCHAR(16),
  turn_seconds      INTEGER,
  -- Roster scoping: 'members' (derive from project members) | 'roster' (explicit).
  participant_scope VARCHAR(16)  NOT NULL DEFAULT 'members',
  -- JSON array of { kind, ref, name } used when participant_scope = 'roster'.
  participants      TEXT         NOT NULL DEFAULT '[]',
  -- Cap on a derived roster so a huge project can't open a 200-turn standup.
  max_participants  INTEGER      NOT NULL DEFAULT 25,
  -- Server-side auto-dispatch on session completion (was client-driven).
  auto_dispatch     BOOLEAN      NOT NULL DEFAULT false,
  next_run_at       TIMESTAMP,
  last_run_at       TIMESTAMP,
  last_status       VARCHAR(24),
  last_session_id   UUID,
  created_by        VARCHAR(36),
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_ceremony_schedules_segment ON ceremony_schedules;
CREATE TRIGGER trg_ceremony_schedules_segment BEFORE INSERT ON ceremony_schedules
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- Hot path for the sweep: enabled schedules whose next_run_at is due. The sweep
-- requires next_run_at IS NOT NULL (it is armed at create/enable time), which is
-- the first-poll guard — a freshly created schedule never replays a backlog.
CREATE INDEX IF NOT EXISTS idx_ceremony_schedules_due     ON ceremony_schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_ceremony_schedules_project ON ceremony_schedules(tenant_id, project_id);

-- Link an auto-opened session back to the schedule that opened it, so the UI can
-- show "last run" and the rollup can distinguish scheduled from ad-hoc ceremonies.
ALTER TABLE ceremony_sessions
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES ceremony_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ceremony_sessions_schedule ON ceremony_sessions(schedule_id);
