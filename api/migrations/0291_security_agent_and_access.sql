-- 0291_security_agent_and_access.sql
-- The Security agent + the access model for the tickets it files.
--
-- Three coupled pieces:
--
--   1. Seed a built-in "Security" agent into every existing tenant's workforce.
--      Like the Validator (0271), it is an ordinary, assignable cloud agent — a
--      normal ide_agents row — marked builtin_kind='security' (the stable marker
--      dispatch keys off, so a team can rename it to "Alice" without breaking the
--      audit sweep). Its persona/skills steer the cloud run to perform a SOC 2
--      audit across all five Trust Service Criteria and report each finding via the
--      `security.record_finding` built-in MCP tool (→ SecurityAuditService: audit
--      ledger + one SECURITY task per finding).
--
--   2. security_ticket_access — the per-tenant setup configuration that decides who
--      can SEE security tickets. Default-DENY: all audience toggles off, allowlists
--      empty. A tenant opts audiences in (humans / hired agents / talent) and/or
--      names specific users/agents. Owner/Admin ALWAYS see them (they configure
--      access), independent of this row. Enforced by SecurityTicketAccessService on
--      every task read surface.
--
--   3. security_audits — the "Security Audit result" record: one row per audit run
--      (running → complete/failed) with the rolled-up summary + counts by severity
--      and by Trust Service Criterion. tasks.security_audit_id (0290) links each
--      finding ticket back to the run that produced it.
--
-- Idempotent: NOT EXISTS-guarded seed + CREATE TABLE IF NOT EXISTS. New tenants
-- provisioned after this migration get a Security agent at tenant-creation time
-- (provisionBuiltinAgents) — the sweep no-ops for a tenant without one.

-- 1. Seed the Security agent -------------------------------------------------
INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT
  'security-t' || t.id,
  t.id,
  'Security',
  'Security — SOC 2 Auditor (all Trust Service Criteria)',
  'Audits the codebase against SOC 2 across all five Trust Service Criteria — Security (Common Criteria), Availability, Processing Integrity, Confidentiality, and Privacy. Reads the real code, dependencies, config, and data flows; for every issue it files an access-restricted SECURITY ticket carrying the severity, the criterion it maps to, and a concrete recommendation, plus an audit-summary result. Its findings are visible only to the people you allow.',
  '["security-audit","soc2","appsec","compliance"]',
  'builderforce-default',
  'active',
  'cloud',
  FALSE,
  0,
  'security'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'security'
);

-- 2. Security-ticket access configuration (per tenant, default-deny) ---------
CREATE TABLE IF NOT EXISTS security_ticket_access (
  tenant_id        INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Whole-audience opt-ins. All false = only Owner/Admin (+ allowlist) can see.
  audiences        JSONB NOT NULL DEFAULT '{"humans":false,"hired":false,"talent":false}',
  -- Explicit per-user grants (users.id values).
  allow_user_ids   JSONB NOT NULL DEFAULT '[]',
  -- Explicit per-agent grants (ide_agents.id values) — a hired agent or talent's agent.
  allow_agent_refs JSONB NOT NULL DEFAULT '[]',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       VARCHAR(64)
);

-- 3. Security audit runs (the surfaced "audit result") -----------------------
CREATE TABLE IF NOT EXISTS security_audits (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The project (repo) the audit ran against; findings are filed into it.
  project_id         INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- The transient anchor task the cloud run hangs on (the run is task-centric).
  anchor_task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  -- ide_agents.id of the Security agent that ran the audit (or 'system').
  agent_ref          VARCHAR(64),
  status             VARCHAR(16) NOT NULL DEFAULT 'running',   -- 'running'|'complete'|'failed'
  trigger_source     VARCHAR(16) NOT NULL DEFAULT 'cron',      -- 'cron'|'manual'
  summary            TEXT,
  findings_count     INTEGER NOT NULL DEFAULT 0,
  -- Rollups computed on finish, e.g. {"critical":1,"high":3,...} / {"security":2,...}.
  counts_by_severity JSONB,
  counts_by_tsc      JSONB,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);

-- "audit history for this tenant", newest first (audit panel + running-run guard).
CREATE INDEX IF NOT EXISTS idx_security_audits_tenant ON security_audits(tenant_id, started_at DESC);
