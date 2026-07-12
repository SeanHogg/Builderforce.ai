-- 0330_escalation_management.sql
-- Generic Escalation Path and Reminder System — 3 business day SLA per level,
-- 24h and 4h pre-deadline reminders, and full escalation audit log.
--
-- Scope: per initiative (initiativeId) and team scope, configurable escalation chains.
-- Entities: board tasks, custom issues, or any tracked item.
--
-- Idempotent / re-runnable: ADD VALUE + ADD COLUMN/TABLE IF NOT EXISTS.

-- 1. Escalation chains table — defines the escalation path per team scope ----------
CREATE TABLE IF NOT EXISTS escalation_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  initiative_id INTEGER,
  order_key VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, initiative_id, order_key)
);

CREATE INDEX IF NOT EXISTS idx_escalation_chains_initiative ON escalation_chains(initiative_id);
CREATE INDEX IF NOT EXISTS idx_escalation_chains_tenant_active ON escalation_chains(tenant_id, is_active);

-- 2. Escalation chain levels table — defines order, owners, and SLA at each level ---
CREATE TABLE IF NOT EXISTS escalation_chain_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id UUID NOT NULL REFERENCES escalation_chains(id) ON DELETE CASCADE,
  level_index INTEGER NOT NULL,
  level_name VARCHAR(255) NOT NULL,
  owner_kind VARCHAR(32) NOT NULL,                 -- user / group_email / ticket_coordinator
  owner_id VARCHAR(64),                            -- userId or group/team ID
  sla_days INTEGER NOT NULL DEFAULT 3,             -- default 3 business days per level
  reminder_24h BOOLEAN NOT NULL DEFAULT true,
  reminder_4h BOOLEAN NOT NULL DEFAULT true,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(chain_id, level_index)
);

CREATE INDEX IF NOT EXISTS idx_escalation_chain_levels_chain ON escalation_chain_levels(chain_id);

-- 3. Escalations table — the active escalation records ----------------------------
CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,                -- board_task / custom_issue / ticket
  entity_id UUID NOT NULL,                         --entity: the escalation's subject
  initiative_id INTEGER,                           -- team scope
  chain_id UUID REFERENCES escalation_chains(id) ON DELETE SET NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'open',      -- open / escalated / resolving / resolving_failed / resolved / closed

  current_level_index INTEGER NOT NULL DEFAULT 0,  -- level we're currently at
  current_level_owner_kind VARCHAR(32),
  current_level_owner_id VARCHAR(64),

  sla_deadline TIMESTAMP NOT NULL,                 -- when this level must be resolved
  sl_breached BOOLEAN NOT NULL DEFAULT false,
  sla_breach_timestamp TIMESTAMP,                  -- when SLA was breached

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  first escalation_at TIMESTAMP,
  resolved_at TIMESTAMP,
  closed_at TIMESTAMP,

  description TEXT,
  external_source_id VARCHAR(120)                  -- link back to original ticket/issue
);

CREATE INDEX IF NOT EXISTS idx_escalations_tenant ON escalations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status_chain ON escalations(status, chain_id);
CREATE INDEX IF NOT EXISTS idx_escalations_initiative ON escalations(initiative_id);
CREATE INDEX IF NOT EXISTS idx_escalations_entity ON escalations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_escalations_deadline ON escalations(sla_deadline);

-- 4. Escalation audit log table — immutable audit trail ---------------------------
CREATE TABLE IF NOT EXISTS escalation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id UUID NOT NULL REFERENCES escalations(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  log_index INTEGER NOT NULL,
  action VARCHAR(40) NOT NULL,                     -- escalation_start / reminder_24h / reminder_4h / escalated / resolved / closed / other
  level_index INTEGER NOT NULL,
  level_name VARCHAR(255) NOT NULL,
  owner_kind VARCHAR(32) NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  description TEXT,
  metadata JSONB,                                  -- additional context (e.g., reminder note, SLA breach details)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(escalation_id, log_index)
);

CREATE INDEX IF NOT EXISTS idx_escalation_audit_escalation ON escalation_audit_log(escalation_id);
CREATE INDEX IF NOT EXISTS idx_escalation_audit_tenant ON escalation_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalation_audit_action ON escalation_audit_log(action, created_at);