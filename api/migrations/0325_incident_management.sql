-- 0325_incident_management.sql
-- Incident management foundation — the "Help Desk / Incident Manager" specialized
-- manager subsystem. A help-desk ticket (Freshdesk / Freshservice) that reads as an
-- incident is triaged by the seeded Incident Manager agent (migration 0326): it
-- classifies which SYSTEM the ticket pertains to, opens a first-class incident, pages
-- the on-call list, and escalates on a timer until acknowledged.
--
-- Data model (the answer to "where does an incident live"): a BRIDGE.
--   • A new 'incident' task_type — so the incident is a first-class KANBAN ticket the
--     Incident Manager agent works with all the existing lane/dispatch machinery
--     (the exact sibling of the Validator's 'gap' and the Security agent's 'security').
--   • prod_incidents (migration 0236) stays the METRICS system of record (severity,
--     MTTR timestamps, Quality lens). We extend it into an active response record and
--     link it to the board task (board_task_id) + war-room chat + escalation state.
--
-- Greenfield around it: on-call rotations, timed escalation policies, a business-
-- contact directory, and an incident timeline/notification log.
--
-- Idempotent / re-runnable: ADD VALUE + ADD COLUMN/TABLE IF NOT EXISTS. The two new
-- enum values ('incident', 'freshdesk') are only ADDED here and never used as a
-- literal in this file, so they are safe inside the migration runner's single-file
-- transaction — the same rule 0290 followed for 'security'. They are first USED as
-- literals in the LATER migration 0326 (agent seed uses varchar builtin_kind, not the
-- enum) and at runtime.

-- 1. INCIDENT task type + Freshdesk connector provider ----------------------
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'incident';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'freshdesk';

-- 2. Incident metadata denormalised onto the board task (renders the board badge
--    + incident drawer without a join; the full record lives in prod_incidents). ---
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_severity VARCHAR(16);  -- sev1|sev2|sev3|sev4
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_status   VARCHAR(20);  -- triage|investigating|mitigated|resolved
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_system   VARCHAR(120); -- the classified affected system
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_id       UUID;         -- → prod_incidents.id (loose, no FK)
CREATE INDEX IF NOT EXISTS idx_tasks_incident_id ON tasks(incident_id);

-- 3. Extend prod_incidents into an active response record -------------------
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS board_task_id        INTEGER;      -- linked 'incident' kanban task
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS affected_system      VARCHAR(120); -- classified by the agent
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS assigned_agent_ref   VARCHAR(64);  -- Incident Manager agent handling it
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS war_room_chat_id     INTEGER;      -- → brain_chats.id (the on-call war room; serial PK)
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS escalation_policy_id UUID;         -- → escalation_policies.id
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS escalation_level     INTEGER NOT NULL DEFAULT 0; -- highest level reached
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS last_escalated_at    TIMESTAMP;    -- when the escalation timer last fired
ALTER TABLE prod_incidents ADD COLUMN IF NOT EXISTS external_url         VARCHAR(512); -- link back to the source ticket

-- 4. On-call rotations + ordered members ------------------------------------
--    A rotation is a named on-call list. Who is on call NOW is resolved from the
--    ordered members: 'manual' → current_index; 'daily'/'weekly' → time-sliced
--    round-robin (day-of-year / ISO-week mod member count) off an anchor.
CREATE TABLE IF NOT EXISTS on_call_rotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  rotation_kind VARCHAR(16) NOT NULL DEFAULT 'manual', -- manual | daily | weekly
  current_index INTEGER NOT NULL DEFAULT 0,            -- pointer for 'manual' round-robin
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_on_call_rotations_tenant ON on_call_rotations(tenant_id, active);
DROP TRIGGER IF EXISTS trg_on_call_rotations_segment ON on_call_rotations;
CREATE TRIGGER trg_on_call_rotations_segment
  BEFORE INSERT ON on_call_rotations
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS on_call_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rotation_id  UUID NOT NULL REFERENCES on_call_rotations(id) ON DELETE CASCADE,
  -- Assignee-encoded target: 'u:<userId>' | 'c:<agentRef>' | 'contact:<businessContactId>'.
  member_ref   VARCHAR(72) NOT NULL,
  display_name VARCHAR(255),
  position     INTEGER NOT NULL DEFAULT 0,   -- order within the rotation
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_on_call_members_rotation ON on_call_members(rotation_id, position);

-- 5. Escalation policies + ordered timed levels -----------------------------
--    A policy matches incidents (optionally by severity) and its levels fire in
--    order: at level.after_minutes past the incident start, if still unacknowledged,
--    page the level's target through the enabled channels.
CREATE TABLE IF NOT EXISTS escalation_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  match_severity VARCHAR(16),                -- null = any severity, else sev1..sev4
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_policies_tenant ON escalation_policies(tenant_id, active);
DROP TRIGGER IF EXISTS trg_escalation_policies_segment ON escalation_policies;
CREATE TRIGGER trg_escalation_policies_segment
  BEFORE INSERT ON escalation_policies
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS escalation_levels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id     UUID NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  level         INTEGER NOT NULL DEFAULT 1,   -- 1,2,3… ascending
  after_minutes INTEGER NOT NULL DEFAULT 15,  -- minutes past incident start to fire this level
  target_kind   VARCHAR(24) NOT NULL DEFAULT 'oncall_rotation', -- oncall_rotation | user | contact | team_chat
  target_ref    VARCHAR(72),                  -- rotation_id | userId | businessContactId
  notify_teams  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_slack  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_levels_policy ON escalation_levels(policy_id, level);

-- 6. Business-contact directory (people to talk to during an incident) -------
CREATE TABLE IF NOT EXISTS business_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  role_title VARCHAR(255),
  company    VARCHAR(255),
  email      VARCHAR(255),
  phone      VARCHAR(64),
  teams_id   VARCHAR(255),               -- MS Teams user/channel id or webhook for direct pings
  notes      TEXT,
  tags       JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_contacts_tenant ON business_contacts(tenant_id, name);
DROP TRIGGER IF EXISTS trg_business_contacts_segment ON business_contacts;
CREATE TRIGGER trg_business_contacts_segment
  BEFORE INSERT ON business_contacts
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- 7. Incident timeline + notification log -----------------------------------
--    Append-only feed for an incident: creation, system classification, assignment,
--    each escalation, every notification delivery, status changes, notes, resolution.
--    Powers the war-room timeline + the "who was paged" audit.
CREATE TABLE IF NOT EXISTS incident_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES prod_incidents(id) ON DELETE CASCADE,
  kind        VARCHAR(24) NOT NULL DEFAULT 'note', -- created|classified|assigned|escalated|notified|status_change|note|resolved
  actor_ref   VARCHAR(72),                         -- agent ref | 'u:<userId>' | 'system'
  message     TEXT,
  channel     VARCHAR(16),                         -- teams|slack|email|inapp (for 'notified')
  target      VARCHAR(255),                        -- who/what was notified
  level       INTEGER,                             -- escalation level (for escalated/notified)
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at);
