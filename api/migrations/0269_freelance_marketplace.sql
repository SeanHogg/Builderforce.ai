-- Freelance worker marketplace.
--
-- A new kind of human account — a freelancer / gig worker for hire — extends the
-- marketplace beyond agents. These humans register, publish a for-hire profile
-- (skills, resume, hourly rate) backed by hired.video, and are hired across many
-- tenants and projects via cross-tenant engagements (hire / interview / terminate).
-- Their time is measured from an audited activity-signal stream ("click sense" +
-- indirect engagement) that resolves into billable timecards.

-- 1) Account-type discriminator. GLOBAL (a freelancer works across many tenants),
--    so it lives on users, not tenant_members. 'standard' = normal builder;
--    'freelancer' = restricted gig account (minimal shell: profile + gigs + timecard).
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type varchar(20) NOT NULL DEFAULT 'standard';

-- 2) For-hire profile (one per freelancer user). Skills / resume / rate + the
--    public-or-private visibility toggle. 'public' = anyone can view the details;
--    'private' = only signed-in users can.
CREATE TABLE IF NOT EXISTS freelancer_profiles (
  user_id                    varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline                   varchar(200),
  bio                        text,
  discipline                 varchar(60),          -- 'developer' | 'dba' | 'designer' | ... (card role)
  skills                     text,                 -- JSON string[] (may be prefilled from hired.video)
  hourly_rate_cents          integer,
  currency                   varchar(3)  NOT NULL DEFAULT 'USD',
  visibility                 varchar(10) NOT NULL DEFAULT 'private', -- 'public' | 'private'
  published                  boolean     NOT NULL DEFAULT false,     -- listed when true AND visibility allows
  availability               varchar(20) NOT NULL DEFAULT 'open',    -- open | limited | unavailable
  location                   varchar(120),
  timezone                   varchar(60),
  -- hired.video linkage (@seanhogg/hired-video-sdk). Job-seeker userId + connection.
  hired_video_user_id        varchar(120),
  hired_video_connection_id  varchar(120),
  hired_video_resume_id      varchar(120),
  hired_video_claim_url      varchar(500),
  -- Native resume fallback (R2 key) when hired.video isn't configured.
  resume_key                 varchar(300),
  resume_filename            varchar(255),
  resume_extract             text,                 -- cached extracted resume JSON from hired.video getProfile
  created_at                 timestamp   NOT NULL DEFAULT now(),
  updated_at                 timestamp   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_published
  ON freelancer_profiles(published) WHERE published = true;

-- 3) Engagements: an employer (tenant) hires a freelancer, optionally onto a
--    project. This is BOTH the hire record AND the cross-tenant membership bridge
--    (a freelancer can hold many active engagements across tenants/projects).
--    Soft-terminate via terminated_at (mirrors agent_purchases.unhired_at).
CREATE TABLE IF NOT EXISTS freelancer_engagements (
  id                  varchar(36) PRIMARY KEY,
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          integer REFERENCES projects(id) ON DELETE SET NULL,
  freelancer_user_id  varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              varchar(20) NOT NULL DEFAULT 'invited', -- invited|interviewing|active|declined|terminated
  rate_cents          integer,                                -- snapshot of agreed rate at hire time
  currency            varchar(3)  NOT NULL DEFAULT 'USD',
  title               varchar(200),                           -- role on this engagement
  note                text,
  created_by_user_id  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  invited_at          timestamp NOT NULL DEFAULT now(),
  hired_at            timestamp,
  terminated_at       timestamp,
  terminated_reason   text,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagements_tenant     ON freelancer_engagements(tenant_id) WHERE terminated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_engagements_freelancer ON freelancer_engagements(freelancer_user_id) WHERE terminated_at IS NULL;
-- One active engagement per (tenant, freelancer, project). COALESCE keeps the
-- tenant-wide (no project) engagement distinct from project-scoped ones.
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_active
  ON freelancer_engagements(tenant_id, freelancer_user_id, COALESCE(project_id, 0))
  WHERE terminated_at IS NULL;

-- 4) Activity signals: the raw, audited "click sense" + engagement stream from
--    the portal AND the VSIX. Every navigation, tool exec, ticket lane move,
--    project update, agent interaction, meeting, etc. Append-only audit; one row
--    per signal. Resolved (offline / on read) into time_entries.
CREATE TABLE IF NOT EXISTS activity_signals (
  id                bigserial PRIMARY KEY,
  user_id           varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         integer REFERENCES tenants(id) ON DELETE CASCADE,
  engagement_id     varchar(36) REFERENCES freelancer_engagements(id) ON DELETE SET NULL,
  project_id        integer,
  source            varchar(20) NOT NULL,   -- portal | vscode | agent | meeting | system
  kind              varchar(40) NOT NULL,   -- nav | tool_exec | ticket_move | project_update | agent_message | agent_run | meeting | heartbeat | ...
  ref               varchar(300),           -- route / tool id / ticket id / chat id / meeting id
  weight            integer NOT NULL DEFAULT 1,   -- engagement intensity (drives active-time resolution)
  duration_seconds  integer,                -- explicit span (e.g. meeting); null = point event
  metadata          text,                   -- JSON
  session_id        varchar(64),
  occurred_at       timestamp NOT NULL DEFAULT now(),
  created_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signals_user_day    ON activity_signals(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_signals_engagement  ON activity_signals(engagement_id, occurred_at);

-- 5) Timecard entries: resolved billable blocks — the "what did you do today"
--    rollup of the signal stream into active-time spans. Editable by the worker
--    before a timecard is submitted. (Named timecard_entries to avoid the existing
--    per-task `time_entries` table from migration 0247, a different subsystem.)
CREATE TABLE IF NOT EXISTS timecard_entries (
  id             varchar(36) PRIMARY KEY,
  engagement_id  varchar(36) NOT NULL REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  user_id        varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_date      date NOT NULL,
  minutes        integer NOT NULL DEFAULT 0,
  source         varchar(20) NOT NULL DEFAULT 'auto',  -- auto | manual | meeting
  description    text,
  billable       boolean NOT NULL DEFAULT true,
  resolved_from  text,                                 -- JSON audit: { firstSignalId, lastSignalId, signalCount }
  timecard_id    varchar(36),
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timecard_entries_engagement_date ON timecard_entries(engagement_id, work_date);
CREATE INDEX IF NOT EXISTS idx_timecard_entries_card            ON timecard_entries(timecard_id);

-- 6) Timecards: approvable per-engagement period rollup (worker submits, employer
--    approves). rate x approved billable minutes = amount owed.
CREATE TABLE IF NOT EXISTS timecards (
  id                   varchar(36) PRIMARY KEY,
  engagement_id        varchar(36) NOT NULL REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  user_id              varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id            integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'draft', -- draft|submitted|approved|rejected|paid
  total_minutes        integer NOT NULL DEFAULT 0,
  billable_minutes     integer NOT NULL DEFAULT 0,
  rate_cents           integer,
  currency             varchar(3) NOT NULL DEFAULT 'USD',
  amount_cents         integer NOT NULL DEFAULT 0,
  submitted_at         timestamp,
  approved_at          timestamp,
  approved_by_user_id  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  reject_reason        text,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timecard_period ON timecards(engagement_id, period_start, period_end);
