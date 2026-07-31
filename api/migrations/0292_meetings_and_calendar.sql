-- 0292_meetings_and_calendar.sql
-- Live video/audio collaboration: scheduled meetings, their attendees, and the
-- per-user calendar connections that back scheduling.
--
-- Three coupled pieces:
--
--   1. meetings — a scheduled OR ad-hoc gathering (standup / planning /
--      retrospective / ad-hoc / a direct 1:1). It carries the media room key
--      (the WebRTC signaling relay is keyed off this) plus, when the organizer
--      has a connected calendar, the pushed calendar event's id + link so we can
--      keep them in sync / delete on cancel. project_id is NULLABLE: an ad-hoc or
--      direct call need not belong to a project.
--
--   2. meeting_attendees — who is invited, their RSVP, and their live join/leave
--      window (drives the roster + presence + attendance record). member_kind
--      mirrors the ceremony seat taxonomy (human / cloud_agent / host_agent).
--
--   3. calendar_connections — per-USER OAuth grants (Google / Microsoft) used to
--      list upcoming events and push a meeting onto the connected calendar.
--      Refresh tokens are stored so access can be silently renewed.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS throughout.

-- 1. Meetings ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- NULLABLE: ad-hoc / direct calls need not belong to a project.
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind                VARCHAR(16) NOT NULL DEFAULT 'adhoc',   -- standup|planning|retrospective|adhoc|direct
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  scheduled_at        TIMESTAMPTZ,                            -- NULL = start-now / instant
  duration_minutes    INTEGER NOT NULL DEFAULT 30,
  status              VARCHAR(16) NOT NULL DEFAULT 'scheduled', -- scheduled|live|ended|cancelled
  created_by          VARCHAR(64),                            -- users.id of the organizer
  -- The media signaling room key. Peers pushing WebRTC offers/answers/ICE join
  -- the CeremonyRoomDO relay keyed `media:<room_key>`. Defaults to the meeting id.
  room_key            VARCHAR(64) NOT NULL,
  video_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mirror of the pushed calendar event (when the organizer has a connection).
  calendar_provider   VARCHAR(16),                            -- google|microsoft
  calendar_event_id   VARCHAR(255),
  calendar_html_link  TEXT,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Upcoming / recent meetings for this tenant+segment", newest scheduled first.
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_scope ON meetings(tenant_id, segment_id, scheduled_at DESC);
-- Project agenda view.
CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project_id);

-- 2. Meeting attendees -------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_kind  VARCHAR(16) NOT NULL DEFAULT 'human',   -- human|cloud_agent|host_agent
  member_ref   VARCHAR(64) NOT NULL,                   -- users.id / ide_agents.id / agent_hosts.id
  member_name  VARCHAR(255) NOT NULL,
  email        VARCHAR(255),                           -- for the calendar invite
  role         VARCHAR(16) NOT NULL DEFAULT 'attendee', -- host|attendee
  response     VARCHAR(16) NOT NULL DEFAULT 'invited',  -- invited|accepted|declined|tentative
  joined_at    TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);
-- "meetings I'm invited to" lookup.
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_member ON meeting_attendees(tenant_id, member_ref);

-- 3. Calendar connections (per user) -----------------------------------------
CREATE TABLE IF NOT EXISTS calendar_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        VARCHAR(64) NOT NULL,                 -- users.id (the connecting person)
  provider       VARCHAR(16) NOT NULL,                 -- google|microsoft
  account_email  VARCHAR(255),
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  scope          TEXT,
  calendar_id    VARCHAR(255) NOT NULL DEFAULT 'primary',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One connection per (user, provider) — reconnect updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_connections_user_provider
  ON calendar_connections(user_id, provider);
