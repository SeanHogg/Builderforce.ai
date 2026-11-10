-- 1336 · PRD 08 — agentic governance: the policy-pack domain (rule-bearing packs).
--
-- Four additive, (tenant_id, segment_id)-scoped tables. DISTINCT from the
-- migration-0348 policy_packs/policy_gates pair (the authoring store behind the
-- runtime's PolicyGate wire enforcement) — those hold tool-call gates; these
-- hold enforceable RULES the governance-auditor audits a repo against. The
-- names carry the `governance_` prefix for exactly that reason.
--
--   governance_policy_packs — a named bundle of rules (org baseline or custom).
--   governance_rules        — one enforceable rule + its deterministic pre-filter.
--   governance_audit_runs   — one audit execution of a repo/ref vs a resolved ruleset.
--   governance_findings     — one finding raised by a run against one rule.
--
-- Additive only: no edits to existing governance tables. The `check` matcher
-- kinds live in JSON (an enum-in-JSON, not a DB enum) so packs can grow
-- matchers without a migration. `rule_ref` is denormalized onto findings so a
-- finding survives rule deletion.

CREATE TABLE IF NOT EXISTS governance_policy_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- BIGINT per directive; FK to projects.id intentionally omitted until projects.id migrates to bigint (tracked: PRD 20 bigint migration). NULL = tenant/segment-wide (org baseline); set = scoped to one project.
  project_id  BIGINT,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  framework   VARCHAR(40),               -- soc2|owasp|gdpr|pci|internal|custom
  status      VARCHAR(20) NOT NULL DEFAULT 'active', -- active|draft|archived
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  created_by  VARCHAR(64),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  pack_id     UUID NOT NULL REFERENCES governance_policy_packs(id) ON DELETE CASCADE,
  rule_ref    VARCHAR(80) NOT NULL,      -- e.g. "SEC.SECRET.NO_HARDCODED"
  category    VARCHAR(40) NOT NULL,      -- secrets|authz|injection|deps|license|change_mgmt|pii|custom
  title       VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,             -- the rule in plain language (the LLM reads this)
  severity    VARCHAR(20) NOT NULL DEFAULT 'medium', -- blocker|critical|high|medium|low|info
  -- Deterministic pre-filter (optional): { kind: regex|path_required|path_forbidden|dependency|glob, ... }
  "check"     JSONB,                     -- quoted: CHECK is a reserved word in Postgres
  guidance    TEXT,                      -- remediation hint surfaced on findings
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance_audit_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- BIGINT per directive; FK to projects.id intentionally omitted until projects.id migrates to bigint (tracked: PRD 20 bigint migration).
  project_id   BIGINT,
  repo_ref     VARCHAR(500),
  ref          VARCHAR(200),             -- branch/commit/PR audited
  trigger      VARCHAR(20) NOT NULL,     -- manual|agent_pr|schedule
  agent_run_id VARCHAR(64),              -- execution id when triggered on an agent PR
  status       VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued|running|completed|failed
  ruleset_hash VARCHAR(64),              -- hash of (DB packs + in-repo overrides) used
  -- [{ packId, name, source: "db"|"repo" }]
  packs_applied JSONB,
  -- { blocker, critical, high, medium, low, info, passed }
  summary      JSONB,
  gate_result  VARCHAR(16),              -- pass|blocked|null (not gating)
  started_at   TIMESTAMP,
  finished_at  TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance_findings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL REFERENCES governance_audit_runs(id) ON DELETE CASCADE,
  rule_id     UUID REFERENCES governance_rules(id) ON DELETE SET NULL,
  rule_ref    VARCHAR(80) NOT NULL,      -- denormalized so findings survive rule deletion
  severity    VARCHAR(20) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  detail      TEXT NOT NULL,             -- what was found + why it violates the rule
  file_path   VARCHAR(1000),
  line        INTEGER,
  evidence    TEXT,                      -- matched snippet / explanation
  remediation TEXT,
  source      VARCHAR(16) NOT NULL DEFAULT 'agent', -- prefilter|agent|vuln_scan
  confidence  VARCHAR(10),               -- high|medium|low (LLM self-rated)
  status      VARCHAR(20) NOT NULL DEFAULT 'open',  -- open|triaged|fixed|accepted_risk|false_positive
  incident_id UUID REFERENCES security_incidents(id) ON DELETE SET NULL, -- CRITICAL auto-opened incident
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Every table on (tenant_id, segment_id).
CREATE INDEX IF NOT EXISTS idx_governance_packs_scope
  ON governance_policy_packs(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_governance_rules_scope
  ON governance_rules(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_governance_rules_pack
  ON governance_rules(pack_id);
CREATE INDEX IF NOT EXISTS idx_governance_audit_runs_scope_status
  ON governance_audit_runs(tenant_id, segment_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_governance_findings_run_severity
  ON governance_findings(run_id, severity);
CREATE INDEX IF NOT EXISTS idx_governance_findings_scope_status
  ON governance_findings(tenant_id, segment_id, status);
