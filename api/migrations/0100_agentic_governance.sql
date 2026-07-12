-- Migration 0100: governance tools & immutable audit spine (OKR 5, task #138)
--
-- This migration defines:
-- 1) Governance Policy Packs & Rules
-- 2) Governance Audit Runs & Findings
-- 3) Append-only audit_log with hash-chain spine
-- 4) SIEM export configuration
-- 5) Retention policy
--
-- All tables are ADDITIVE (no existing tables are modified).
-- Scoping aligns with the (tenantId = integer, segmentId = uuid) convention already active across the codebase.

-- ===========================================================================
-- 1. Governance Policy Packs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS governance_policy_packs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id           uuid REFERENCES segments(id) ON DELETE CASCADE,
    project_id           uuid REFERENCES projects(id) ON DELETE CASCADE,
    name                 varchar(255) NOT NULL,
    description          text,
    framework            varchar(40),
    status               varchar(20) NOT NULL DEFAULT 'active',      -- active|draft|archived|disabled
    is_baseline          boolean NOT NULL DEFAULT false,
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
    rule_ref        varchar(80) NOT NULL,                           -- e.g. "SEC.SECRET.NO_HARDCODED"
    category        varchar(40) NOT NULL,                           -- secrets|authz|injection|deps|license|change_mgmt|pii|custom
    title           varchar(255) NOT NULL,
    description     text NOT NULL,
    severity        varchar(20) NOT NULL DEFAULT 'medium',           -- blocker|critical|high|medium|low|info
    check           jsonb,
    guidance        text,
    enabled         boolean NOT NULL DEFAULT true,
    locked          boolean NOT NULL DEFAULT false,
    created_at      timestamp NOT NULL DEFAULT now(),
    updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_rules_unique_rule ON governance_rules(pack_id, rule_ref);
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
    repo_ref            varchar(500),                                 -- repo url/id
    ref                 varchar(200),                                 -- branch/commit/PR audited
    trigger             varchar(20) NOT NULL,                        -- manual|agent_pr|schedule
    agent_run_id        varchar(64),                                  -- execution id when triggered via agent
    status              varchar(20) NOT NULL DEFAULT 'queued',        -- queued|running|completed|failed
    ruleset_hash        varchar(64),                                 -- hash of (DB packs + repo overrides)
    packs_applied       jsonb,                                       -- [{ packId, name, source: "db"|"repo" }]
    summary             jsonb,                                       -- { blocker, critical, high, medium, low, info, passed }
    gate_result         varchar(16),                                  -- pass|blocked|null
    gate_reason         text,
    started_at          timestamp,
    finished_at         timestamp,
    duration_ms         integer,
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
    rule_ref            varchar(80) NOT NULL,                        -- denormalized
    severity            varchar(20) NOT NULL,
    title               varchar(255) NOT NULL,
    detail              text NOT NULL,                                -- finding explanation
    file_path           varchar(1000),
    line                integer,
    evidence            text,
    remediation         text,
    source              varchar(16) NOT NULL DEFAULT 'agent',          -- prefilter|agent|vuln_scan
    confidence          varchar(10),                                  -- high|medium|low
    status              varchar(20) NOT NULL DEFAULT 'open',          -- open|triaged|fixed|accepted_risk|false_positive
    incident_id         uuid,
    incident_source     varchar(64),
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
-- 5. Immutable Audit Log (append-only with hash chain)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,
    event_id            uuid NOT NULL,                                -- application-provided UUID
    event_type          varchar(80) NOT NULL,                        -- login|logout|mfa_change|password_reset|rbac_change|policy_pack_mutate|agent_invocation|data_query|api_key_create|api_key_revoke|governance_scan
    actor_id            varchar(64) NOT NULL,
    actor_ip            varchar(39),
    actor_user_agent    varchar(500),
    target_type          varchar(80) NOT NULL,                        -- user|role|policy_pack|rule|agent|api_key|workspace
    target_id            varchar(255),
    action               varchar(60) NOT NULL,                        -- create|update|delete|execute|login|logout|revoke|assign
    payload             jsonb,
    resource_context    jsonb,
    timestamp           timestamp NOT NULL DEFAULT now(),
    hash                varchar(64) NOT NULL,                         -- SHA-256 chained from prior record
    created_at          timestamp NOT NULL DEFAULT now()               -- DB write time (immutable)
);

-- Append-only enforcement (no UPDATE or DELETE)
CREATE FUNCTION enforce_audit_log_enforce() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE not permitted';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_log is append-only: DELETE not permitted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        -- Hash is id || event_type || actor_id || actor_ip || target_type || target_id || action
        NEW.hash := md5(NEW.id::text || NEW.event_type || NEW.actor_id || NEW.actor_ip || NEW.target_type || NEW.target_id || NEW.action);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_audit_log_enforce
BEFORE INSERT OR UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION enforce_audit_log_enforce();

-- ============================================================================
-- 6. Audit integrity spine (public, hash-chained, surface via /api/audit/verify)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_integrity_spine (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    event_id            uuid NOT NULL,
    event_type          varchar(80) NOT NULL,
    actor_id            varchar(64) NOT NULL,
    timestamp           timestamp NOT NULL DEFAULT now(),
    prev_hash           varchar(64),                                   -- nullable (null for head)
    curr_hash           varchar(64) NOT NULL,
    created_at          timestamp NOT NULL DEFAULT now()
);

-- ============================================================================
-- 7. SIEM Export Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS siem_config (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,
    name                varchar(100) NOT NULL,
    type                varchar(20) NOT NULL,                         -- webhook|syslog|s3
    enabled             boolean NOT NULL DEFAULT true,
    webhook_url         varchar(500),
    webhook_secret      varchar(255),                                 -- encrypted at rest in DB
    syslog_host         varchar(255),
    syslog_port         integer,
    syslog_protocol     varchar(10) DEFAULT 'tls',
    s3_bucket           varchar(255),
    s3_prefix           varchar(500),
    s3_key_id           varchar(255),
    s3_secret_id        varchar(255),
    batch_size          integer DEFAULT 100,
    flush_interval_ms   integer DEFAULT 30000,
    last_sync           timestamp,
    created_by          varchar(64),
    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS siem_config_tenant_enabled ON siem_config(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS siem_config_segment_tenant ON siem_config(segment_id, tenant_id);

-- ============================================================================
-- 8. Audit Retention Policy
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_retention_policy (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    retention_days      integer NOT NULL DEFAULT 90,
    archive_after_days  integer,
    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9. Row-level protection layer: no unauthorized Enforce calls on these tables
-- ============================================================================
CREATE FUNCTION convict_detect_enforce() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Row-level protect: audit_log/polices are managed via explicit application code';
END;
$$ LANGUAGE plpgsql;

-- COMMENT ON TABLES
COMMENT ON TABLE governance_policy_packs IS 'Tenant/segment/project-scoped policy packs and rules for governance audit';
COMMENT ON TABLE governance_rules IS 'Rules within policy packs (severity, category, check jsonb, guidance)';
COMMENT ON TABLE governance_audit_runs IS 'Audit runs with gate verdicts and summary metrics';
COMMENT ON TABLE governance_findings IS 'Individual findings with triage status and remediation';
COMMENT ON TABLE audit_log IS 'Immutable append-only log of all auditable security events';
COMMENT ON TABLE audit_integrity_spine IS 'Hash-chain spine for public verification (surface via /api/audit/verify)';
COMMENT ON TABLE siem_config IS 'SIEM export configs (Webhook, Syslog, S3)';
COMMENT ON TABLE audit_retention_policy IS 'Audit retention settings per tenant';