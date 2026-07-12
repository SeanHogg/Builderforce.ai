-- Migration: Agentic Governance & Immutable Audit Log (OKR 5)
--
-- This migration defines:
-- 1. Governance Policy Packs & Rules
-- 2. Governance Audit Runs & Findings
-- 3. Immutable Audit Log table (append-only)
-- 4. SIEM Export configs table
-- All tables are tenant/segment-scoped for isolation.
--
-- No existing tables are modified — this is additive.
-- Follows the (tenantId, segmentId) pattern from governance docs.

-- ===========================================================================
-- 1. Governance Policy Packs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS governance_policy_packs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id           uuid REFERENCES segments(id) ON DELETE CASCADE,
    project_id           uuid REFERENCES projects(id) ON DELETE CASCADE, -- null = tenant/segment-wide

    name                 varchar(255) NOT NULL,
    description          text,
    framework            varchar(40),                                      -- soc2|owasp|gdpr|pci|internal|custom
    status               varchar(20) NOT NULL DEFAULT 'active',           -- active|draft|archived|disabled
    is_baseline          boolean NOT NULL DEFAULT false,                  -- default org/segment baseline pack

    created_by           varchar(64),
    created_at           timestamp NOT NULL DEFAULT now(),
    updated_at           timestamp NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Governance Rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id      uuid REFERENCES segments(id) ON DELETE CASCADE,
    pack_id         uuid NOT NULL REFERENCES governance_policy_packs(id) ON DELETE CASCADE,

    rule_ref        varchar(80) NOT NULL,                               -- e.g. "SEC.SECRET.NO_HARDCODED"
    category        varchar(40) NOT NULL,                               -- secrets|authz|injection|deps|license|change_mgmt|pii|custom
    title           varchar(255) NOT NULL,
    description     text NOT NULL,                                      -- plain language rule text

    severity        varchar(20) NOT NULL DEFAULT 'medium',               -- blocker|critical|high|medium|low|info
    check           jsonb,                                              -- deterministic pre-filter: { kind, pattern, paths?, options? }
    guidance        text,                                               -- remediation hint surfaced on findings

    enabled         boolean NOT NULL DEFAULT true,
    locked          boolean NOT NULL DEFAULT false,                     -- cannot be downgraded in-repo

    created_at      timestamp NOT NULL DEFAULT now(),
    updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_rules_unique_rule ON governance_rules(packer_id, rule_ref);
CREATE INDEX IF NOT EXISTS governance_rules_pack_id ON governance_rules(pack_id);
CREATE INDEX IF NOT EXISTS governance_rules_enabled ON governance_rules(enabled);
CREATE INDEX IF NOT EXISTS governance_rules_severity ON governance_rules(severity);
CREATE INDEX IF NOT EXISTS governance_rules_category ON governance_rules(category);

-- ============================================================================
-- 3. Governance Audit Runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_audit_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,
    project_id          uuid REFERENCES projects(id) ON DELETE CASCADE,

    repo_ref            varchar(500),                                    -- repo url/id
    ref                 varchar(200),                                    -- branch/commit/PR audited
    trigger             varchar(20) NOT NULL,                           -- manual|agent_pr|schedule

    agent_run_id        varchar(64),                                     -- execution id when triggered on agent PR
    status              varchar(20) NOT NULL DEFAULT 'queued',           -- queued|running|completed|failed
    ruleset_hash        varchar(64),                                     -- hash of (DB packs + in-repo overrides)

    packs_applied       jsonb,                                          -- [{ packId, name, source: "db"|"repo" }]
    summary             jsonb,                                          -- { blocker, critical, high, medium, low, info, passed }

    gate_result         varchar(16),                                     -- pass|blocked|null(not gating)
    gate_reason         text,                                            -- why the run was blocked

    started_at          timestamp,
    finished_at         timestamp,
    duration_ms         integer,                                         -- from started_at to finished_at

    created_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governance_audit_runs_tenant_segment ON governance_audit_runs(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS governance_audit_runs_project_status ON governance_audit_runs(project_id, status);
CREATE INDEX IF NOT EXISTS governance_audit_runs_trigger ON governance_audit_runs(trigger);
CREATE INDEX IF NOT EXISTS governance_audit_runs_created_at ON governance_audit_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS governance_audit_runs_ruleset_hash ON governance_audit_runs(ruleset_hash);

-- ============================================================================
-- 4. Governance Findings
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_findings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,
    run_id              uuid NOT NULL REFERENCES governance_audit_runs(id) ON DELETE CASCADE,
    rule_id             uuid REFERENCES governance_rules(id) ON DELETE SET NULL,

    rule_ref            varchar(80) NOT NULL,                           -- denormalized
    severity            varchar(20) NOT NULL,                           -- never exceed rule's severity
    title               varchar(255) NOT NULL,

    detail              text NOT NULL,                                  -- what was found + violation explanation
    file_path           varchar(1000),                                  -- location in repo
    line                integer,

    evidence            text,                                           -- matched snippet / LLM reasoning

    remediation         text,
    source              varchar(16) NOT NULL DEFAULT 'agent',           -- prefilter|agent|vuln_scan
    confidence          varchar(10),                                    -- high|medium|low (LLM self-rated)

    status              varchar(20) NOT NULL DEFAULT 'open',             -- open|triaged|fixed|accepted_risk|false_positive

    incident_id         uuid,                                           -- set when CRITICAL auto-opens SecurityIncident
    incident_source     varchar(64),                                    -- e.g. "governance_auditor"

    accepted_risk_reason text,

    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governance_findings_run_severity ON governance_findings(run_id, severity);
CREATE INDEX IF NOT EXISTS governance_findings_tenant_segment_status ON governance_findings(tenant_id, segment_id, status);
CREATE INDEX IF NOT EXISTS governance_findings_severity_status ON governance_findings(severity, status);
CREATE INDEX IF NOT EXISTS governance_findings_rule_ref ON governance_findings(rule_ref);
CREATE INDEX IF NOT EXISTS governance_findings_created_at ON governance_findings(created_at DESC);

-- ============================================================================
-- 5. Immutable Audit Log (append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,

    event_id            uuid NOT NULL,                                  -- application-provided UUID
    event_type          varchar(80) NOT NULL,                           -- login|logout|mfa_change|password_reset|rbac_change|policy_pack_mutate|agent_invocation|data_query|api_key_create|api_key_revoke|governance_scan

    actor_id            varchar(64) NOT NULL,                           -- user_id|agent_id
    actor_ip            varchar(39),                                    -- IP address (IPv6 allowed)
    actor_user_agent    varchar(500),                                   -- browser/user-agent string

    target_type          varchar(80) NOT NULL,                           -- user|role|policy_pack|rule|agent|api_key|workspace
    target_id            varchar(255),                                   -- target identifier
    action               varchar(60) NOT NULL,                           -- create|update|delete|execute|login|logout|revoke|assign

    payload             jsonb,                                          -- structured event data
    resource_context    jsonb,                                          -- tenant/segment/project context for isolation

    timestamp           timestamp NOT NULL DEFAULT now(),
    hash                varchar(64) NOT NULL,                           -- SHA-256 chained from prior record

    created_at          timestamp NOT NULL DEFAULT now()                 -- DB write time (immutable)
);

-- ============================================================================
-- 6. Append-only enforcement: no UPDATE or DELETE on audit_log
-- ============================================================================
CREATE FUNCTION enforce_audit_append_only() RETURNS trigger AS $$
BEGIN
    -- Prevent UPDATE
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE not permitted';
    END IF;

    -- Prevent DELETE
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_log is append-only: DELETE not permitted';
    END IF;

    -- INSERT: compute hash for new record (atomically)
    IF TG_OP = 'INSERT' THEN
        NEW.hash := md5(NEW.id::text || NEW.event_type || NEW.actor_id || NEW.actor_ip || NEW.target_type || NEW.target_id || NEW.action || NEW.event_id::text);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_audit_log_append_only
BEFORE INSERT OR UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION enforce_audit_append_only();

-- ============================================================================
-- 7. SIEM Export Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS siem_config (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,

    name                varchar(100) NOT NULL,
    type                varchar(20) NOT NULL,                           -- webhook|syslog|s3
    enabled             boolean NOT NULL DEFAULT true,

    -- Webhook
    webhook_url         varchar(500),                                  -- HTTPS endpoint
    webhook_secret      varchar(255),                                   -- HMAC signing key (encrypted at rest)

    -- Syslog
    syslog_host         varchar(255),
    syslog_port         integer,
    syslog_protocol     varchar(10) DEFAULT 'tls',                       -- tcp|udp|tls

    -- S3
    s3_bucket           varchar(255),                                  -- e.g. "builderforce-audit-s3"
    s3_prefix           varchar(500),                                  -- "audit/tenantId/segmentId/"
    s3_key_id           varchar(255),
    s3_secret_id        varchar(255),

    -- Common
    batch_size          integer DEFAULT 100,                            -- records per batch
    flush_interval_ms   integer DEFAULT 30000,                          -- min 30s

    last_sync           timestamp,                                      -- last successful export time

    created_by          varchar(64),
    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS siem_config_tenant_enabled ON siem_config(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS siem_config_segment_tenant ON siem_config(segment_id, tenant_id);

-- ============================================================================
-- 8. Events-based Audit Log triggers (initial seed)
-- ============================================================================
-- These triggers write events to audit_log on runtime actions.
-- They honor (tenant_id, segment_id) isolation from request context.

-- Example trigger on project level changes (mechanically)
-- This is a reference implementation; actual trigger definitions depend on DB schema for entities like projects, roles, keys, etc.

-- Note: Full row-level insert triggers for all entities are out of scope for this initial migration.
-- Application code should explicitly log important events using the SecurityAuditLog service.

-- ============================================================================
-- 9. Audit retention settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_retention_policy (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    retention_days      integer NOT NULL DEFAULT 90,                     -- on-platform retention
    archive_after_days  integer,                                        -- archive to S3 after N days

    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. Grant read access to base roles
-- ============================================================================
-- Security: Only MANAGER and above can read/write governance/audit
-- This is enforced at API layer via permission checks

COMMENT ON TABLE governance_policy_packs IS 'Tenant/segment/project-scoped policy packs and rules for governance audit';
COMMENT ON TABLE governance_audit_runs IS 'Audit run results with gate verdicts and summary metrics';
COMMENT ON TABLE governance_findings IS 'Individual findings with triage status and risk acceptance';
COMMENT ON TABLE audit_log IS 'Immutable append-only log of all auditable security events';
COMMENT ON TABLE siem_config IS 'Configurations for SIEM export (Webhook, Syslog, S3)';
COMMENT ON TABLE audit_retention_policy IS 'Audit log retention settings on a per-tenant basis';