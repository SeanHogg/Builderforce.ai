-- 0334_escalation_governance.sql
-- Governance Escalation Path and Reminder System (task #507)
-- Distinct from prod-incident on-call paging (migration 0325, 3-minute paging timers).
-- This system models BUSINESS-DAY SLA escalations with configurable PM → Director → VP
-- → C-suite chains per initiative/team scope, 24h+4h reminders, and an immutable audit
-- log capturing resolution outcome, SLA breach, steps taken and recommended options.
--
-- Renumbered from 0330_escalation_management.sql which COLLIDED with the already-present
-- 0330_meeting_transcripts.sql on the base branch — the first agent pass produced this
-- file with the same 0330 prefix as an existing migration, causing a conflict on sync.
-- It was deleted and re-created here as 0334, the next open number on main.
--
-- Idempotent / re-runnable: ADD VALUE + CREATE ... IF NOT EXISTS.

-- Supportful enums for governance escalations
DO $$ BEGIN
  CREATE TYPE governance_escalation_status AS ENUM ('open','escalated','resolving','resolving_failed','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE governance_escalation_entity_kind AS ENUM ('board_task','initiative','security','compliance','custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Governance escalation chains — the named chain definition per initiative/team scope
--    Fields per the PRD deliverable "escalation chain data model (initiativeId/effectiveLevel/sequence)"
CREATE TABLE IF NOT EXISTS governance_escalation_chains (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  team_scope    VARCHAR(128) NOT NULL DEFAULT 'default',     -- e.g. Team-A, engineering, compliance
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  default_sla_days INTEGER NOT NULL DEFAULT 3,               -- default 3 business days per level (FR.2)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, initiative_id, team_scope, name)
);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_chains_tenant ON governance_escalation_chains(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_chains_initiative ON governance_escalation_chains(initiative_id);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_chains_scope ON governance_escalation_chains(team_scope);
DROP TRIGGER IF EXISTS trg_governance_escalation_chains_segment ON governance_escalation_chains;
CREATE TRIGGER trg_governance_escalation_chains_segment
  BEFORE INSERT ON governance_escalation_chains
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- 2. Governance escalation chain levels — effectiveLevel + sequence, owner per level
CREATE TABLE IF NOT EXISTS governance_escalation_chain_levels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chain_id            UUID NOT NULL REFERENCES governance_escalation_chains(id) ON DELETE CASCADE,
  -- PRD required: effectiveLevel (computed authority rank) + sequence (ordering)
  -- sequence is the physical order (0,1,2); effective_level is the authority tier (PM=1, Director=2, etc.) so non-linear chains are possible (skip levels)
  sequence_index      INTEGER NOT NULL DEFAULT 0,            -- the physical ordering in the chain: 0,1,2…
  effective_level     INTEGER NOT NULL DEFAULT 1,            -- authority tier stored on the row: 1=PM, 2=Director, 3=VP, 4=C-suite, 5=Board
  level_name          VARCHAR(128) NOT NULL DEFAULT 'level', -- e.g. PM, Director, VP, C-suite
  owner_kind          VARCHAR(32) NOT NULL DEFAULT 'user',   -- user | role | group_email | team | board_coordinator
  owner_id            VARCHAR(128),                          -- human userId / role key (manager, director, vp, c_suite) / team slug / email group
  owner_display_name  VARCHAR(255),
  -- Per-level SLA override (FR.2 configurable per level) — null = inherit from chain/default
  sla_days            INTEGER,                               -- business days; null → chain default
  -- Notification toggles for this level (stored, wired later to internal notify mechanism)
  reminder_24h        BOOLEAN NOT NULL DEFAULT true,         -- AC.4 @ 24h pre-deadline
  reminder_4h         BOOLEAN NOT NULL DEFAULT true,         -- AC.4 @ 4h pre-deadline
  auto_escalate       BOOLEAN NOT NULL DEFAULT true,         -- AC.3 auto-escalate when this level's SLA expires
  is_terminal         BOOLEAN NOT NULL DEFAULT false,        -- this level is the end of the chain (no further auto-escalation)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain_id, sequence_index)
);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_levels_chain ON governance_escalation_chain_levels(chain_id, sequence_index);

-- 3. Governance escalation records — the ACTIVE escalation instance with SLA deadline
CREATE TABLE IF NOT EXISTS governance_escalations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  initiative_id       UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  team_scope          VARCHAR(128) NOT NULL DEFAULT 'default',
  chain_id            UUID REFERENCES governance_escalation_chains(id) ON DELETE SET NULL,
  -- Links to the subject (optional board task or generic entity)
  entity_kind         governance_escalation_entity_kind NOT NULL DEFAULT 'board_task',
  entity_id           UUID,                                  -- board task id / initiative id / security id — logical id within entity_kind
  board_task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL, -- explicit task FK for board tasks
  -- Escalation state
  status              governance_escalation_status NOT NULL DEFAULT 'open',
  title               VARCHAR(500) NOT NULL DEFAULT 'Untitled escalation',
  description         TEXT,
  priority            VARCHAR(16) NOT NULL DEFAULT 'high',  -- low|medium|high|urgent
  -- Current authority level we're at
  current_sequence    INTEGER NOT NULL DEFAULT 0,
  current_level_name  VARCHAR(128),
  current_owner_kind  VARCHAR(32),
  current_owner_id    VARCHAR(128),
  current_owner_name  VARCHAR(255),
  -- SLA timer — set within 15 minutes of trigger (FR.3). Breach → auto-escalate (AC.3) unless terminal.
  sla_deadline        TIMESTAMPTZ,                            -- computed as trigger + N business days
  sla_breached        BOOLEAN NOT NULL DEFAULT false,
  sla_breach_count    INTEGER NOT NULL DEFAULT 0,
  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),    -- when the escalation was first triggered
  last_advanced_at    TIMESTAMPTZ,                            -- when we last escalated to the next level
  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_by_user_id  VARCHAR(36),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_escalations_tenant_status ON governance_escalations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_gov_escalations_initiative ON governance_escalations(initiative_id);
CREATE INDEX IF NOT EXISTS idx_gov_escalations_chain ON governance_escalations(chain_id);
CREATE INDEX IF NOT EXISTS idx_gov_escalations_task ON governance_escalations(board_task_id);
CREATE INDEX IF NOT EXISTS idx_gov_escalations_deadline ON governance_escalations(sla_deadline) WHERE status IN ('open','escalated');
CREATE INDEX IF NOT EXISTS idx_gov_escalations_triggered ON governance_escalations(triggered_at);
DROP TRIGGER IF EXISTS trg_governance_escalations_segment ON governance_escalations;
CREATE TRIGGER trg_governance_escalations_segment
  BEFORE INSERT ON governance_escalations
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- 4. Governance escalation immutable audit log — the FR.5 audit trail + resolution capture
--    Captures: resolution outcome, SLA breach, steps taken, recommended resolution options (AC.5)
CREATE TABLE IF NOT EXISTS governance_escalation_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id       UUID NOT NULL REFERENCES governance_escalations(id) ON DELETE CASCADE,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Ordering within the escalation (append-only, immutable)
  log_index           INTEGER NOT NULL,
  -- What happened at this log entry
  action              VARCHAR(40) NOT NULL,                  -- escalation_triggered | reminder_24h | reminder_4h | escalated | level_changed | resolving | resolved | closed | reopened | note | outcome_recorded
  sequence_index      INTEGER NOT NULL DEFAULT 0,
  effective_level     INTEGER,
  level_name          VARCHAR(128) NOT NULL DEFAULT '',
  owner_kind          VARCHAR(32),
  owner_id            VARCHAR(128),
  owner_display_name  VARCHAR(255),
  -- FR.5 fields persisted on outcome/resolution entries
  resolution_outcome  VARCHAR(64),                           -- fixed|wontfix|duplicate|withdrawn|escalated_beyond|resolved_by_subtask|manual
  sla_breached        BOOLEAN NOT NULL DEFAULT false,
  steps_taken         TEXT,                                  -- description of steps
  recommended_options JSONB NOT NULL DEFAULT '[]',           -- array of { title, description } recommended resolution options
  metadata            JSONB NOT NULL DEFAULT '{}',           -- free-form: breach detail, reminder channel, escalation reason, etc.
  actor_kind          VARCHAR(16) NOT NULL DEFAULT 'user',   -- user | system | cron
  actor_id            VARCHAR(128),
  message             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(escalation_id, log_index)
);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_logs_escalation ON governance_escalation_logs(escalation_id, log_index);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_logs_tenant ON governance_escalation_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_logs_action ON governance_escalation_logs(action, created_at);

-- 5. Governance escalation reminder ledger — prevents duplicate 24h / 4h reminder sends (AC.4 guard)
CREATE TABLE IF NOT EXISTS governance_escalation_reminders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id  UUID NOT NULL REFERENCES governance_escalations(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL DEFAULT 0,
  kind           VARCHAR(16) NOT NULL,                       -- reminder_24h | reminder_4h | deadline_breach
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(escalation_id, sequence_index, kind)
);
CREATE INDEX IF NOT EXISTS idx_gov_escalation_reminders_escalation ON governance_escalation_reminders(escalation_id);
