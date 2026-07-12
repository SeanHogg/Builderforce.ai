-- Migration: Agentic Governance & Immutable Audit Log (OKR 5)
--
-- This migration defines:
-- 1. Governance Policy Packs & Rules
-- 2. Governance Audit Runs & Findings (Panel敏捷 governance toolset)
-- 3. Immutable Audit Log table (append-only)
-- 4. Hash chain extension node (integrity check spine)
-- 5. SIEM Export configs table
-- All tables are tenant/segment-scoped for isolation.
--
-- No existing tables are modified — this is additive.
-- Follows the (tenantId, segmentId) pattern from governance docs and segments schema (segments.id = uuid).

-- ===========================================================================
-- 1. Governance Policy Packs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS governance_policy_packs (
    id                   uuid Primary Key DEFAULT gen_random_uuid(),
    tenant_id            integer Not Null References tenants(id) On Delete Cascade,
    segment_id           uuid References segments(id) On Delete Cascade,
    project_id           uuid References projects(id) On Delete Cascade,

    name                 varchar(255) Not Null,
    description          text,
    framework            varchar(40),
    status               varchar(20) Not Null Default 'active',
    is_baseline          boolean Not Null Default false,

    created_by           varchar(64),
    created_at           timestamp Not Null Default now(),
    updated_at           timestamp Not Null Default now()
);

-- ============================================================================
-- 2. Governance Rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_rules (
    id              uuid Primary Key Default gen_random_uuid(),
    tenant_id       integer Not Null References tenants(id) On Delete Cascade,
    segment_id      uuid References segments(id) On Delete Cascade,
    pack_id         uuid Not Null References governance_policy_packs(id) On Delete Cascade,

    rule_ref        varchar(80) Not Null,
    category        varchar(40) Not Null,
    title           varchar(255) Not Null,
    description     text Not Null,

    severity        varchar(20) Not Null Default 'medium',
    check           jsonb,
    guidance        text,

    enabled         boolean Not Null Default true,
    locked          boolean Not Null Default false,

    created_at      timestamp Not Null Default now(),
    updated_at      timestamp Not Null Default now()
);

Create Unique Index If Not Exists governance_rules_unique_rule On governance_rules(pack_id, rule_ref);
Create Index If Not Exists governance_rules_pack_id On governance_rules(pack_id);
Create Index If Not Exists governance_rules_enabled On governance_rules(enabled);
Create Index If Not Exists governance_rules_severity On governance_rules(severity);
Create Index If Not Exists governance_rules_category On governance_rules(category);

-- ============================================================================
-- 3. Governance Audit Runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_audit_runs (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null References tenants(id) On Delete Cascade,
    segment_id          uuid References segments(id) On Delete Cascade,
    project_id          uuid References projects(id) On Delete Cascade,

    repo_ref            varchar(500),
    ref                 varchar(200),
    trigger             varchar(20) Not Null,

    agent_run_id        varchar(64),
    status              varchar(20) Not Null Default 'queued',
    ruleset_hash        varchar(64),

    packs_applied       jsonb,
    summary             jsonb,

    gate_result         varchar(16),
    gate_reason         text,

    started_at          timestamp,
    finished_at         timestamp,
    duration_ms         integer,

    created_at          timestamp Not Null Default now()
);

Create Index If Not Exists governance_audit_runs_tenant_segment On governance_audit_runs(tenant_id, segment_id);
Create Index If Not Exists governance_audit_runs_project_status On governance_audit_runs(project_id, status);
Create Index If Not Exists governance_audit_runs_trigger On governance_audit_runs(trigger);
Create Index If Not Exists governance_audit_runs_created_at On governance_audit_runs(created_at Desc);
Create Index If Not Exists governance_audit_runs_ruleset_hash On governance_audit_runs(ruleset_hash);

-- ============================================================================
-- 4. Governance Findings
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_findings (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null References tenants(id) On Delete Cascade,
    segment_id          uuid References segments(id) On Delete Cascade,
    run_id              uuid Not Null References governance_audit_runs(id) On Delete Cascade,
    rule_id             uuid References governance_rules(id) On Delete Set Null,

    rule_ref            varchar(80) Not Null,
    severity            varchar(20) Not Null,
    title               varchar(255) Not Null,

    detail              text Not Null,
    file_path           varchar(1000),
    line                integer,

    evidence            text,

    remediation         text,
    source              varchar(16) Not Null Default 'agent',
    confidence          varchar(10),

    status              varchar(20) Not Null Default 'open',

    incident_id         uuid,
    incident_source     varchar(64),

    accepted_risk_reason text,

    created_at          timestamp Not Null Default now(),
    updated_at          timestamp Not Null Default now()
);

Create Index If Not Exists governance_findings_run_severity On governance_findings(run_id, severity);
Create Index If Not Exists governance_findings_tenant_segment_status On governance_findings(tenant_id, segment_id, status);
Create Index If Not Exists governance_findings_severity_status On governance_findings(severity, status);
Create Index If Not Exists governance_findings_rule_ref On governance_findings(rule_ref);
Create Index If Not Exists governance_findings_created_at On governance_findings(created_at Desc);

-- ============================================================================
-- 5. Immutable Audit Log (append-only)
-- ============================================================================
Create Table If Not Exists audit_log (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null References tenants(id) On Delete Cascade,
    segment_id          uuid References segments(id) On Delete Cascade,

    event_id            uuid Not Null,
    event_type          varchar(80) Not Null,
    actor_id            varchar(64) Not Null,
    actor_ip            varchar(39),
    actor_user_agent    varchar(500),

    target_type          varchar(80) Not Null,
    target_id            varchar(255),
    action               varchar(60) Not Null,

    payload             jsonb,
    resource_context    jsonb,

    timestamp           timestamp Not Null Default now(),
    hash                varchar(64) Not Null,

    created_at          timestamp Not Null Default now()
);

-- ============================================================================
-- 6. Append-only enforcement with hash chain extension
-- ============================================================================
Create Function enforce_audit_log_enforce() Returns Trigger As $$
Begin
    If TG_OP = 'UPDATE' Then
        Raise Exception 'audit_log is append-only: update not permitted';
    End If;
    If TG_OP = 'DELETE' Then
        Raise Exception 'audit_log is append-only: delete not permitted';
    End If;
    If TG_OP = 'INSERT' Then
        -- Compute hash (id || event_type || actor_id || actor_ip || target_type || target_id || action)::text
        New.hash := md5(New.id::text || New.event_type || New.actor_id || New.actor_ip || New.target_type || New.target_id || New.action);
    End If;
    Return New;
End;
$$ Language plpgsql;

Create Trigger enforce_audit_log_enforce
Before Insert Or Update Or Delete On audit_log
For Each Row Execute Function enforce_audit_log_enforce();

-- ============================================================================
-- 7. Governance Audit History (append-only integrity spine for public verification)
-- ============================================================================
Create Table If Not Exists governance_audit_history (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null References tenants(id) On Delete Cascade,
    segment_id          uuid Not Null References segments(id) On Delete Cascade,

    event_id            uuid Not Null,
    event_type          varchar(80) Not Null,
    actor_id            varchar(64) Not Null,
    timestamp           timestamp Not Null Default now(),

    prev_hash           varchar(64),
    curr_hash           varchar(64),

    created_at          timestamp Not Null Default now()
);

-- Create Index If Not Exists governance_audit_history_tenant_segment ON governance_audit_history(tenant_id, segment_id);
-- Create Index If Not Exists governance_audit_history_created_at ON governance_audit_history(created_at Desc);
-- Create Index If Not Exists governance_audit_history_event_id ON governance_audit_history(event_id);

-- ============================================================================
-- 8. SIEM Export Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS siem_config (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null REFERENCES tenants(id) On Delete Cascade,
    segment_id          uuid REFERENCES segments(id) On Delete Cascade,

    name                varchar(100) Not Null,
    type                varchar(20) Not Null,
    enabled             boolean Not Null Default true,

    webhook_url         varchar(500),
    webhook_secret      varchar(255),

    syslog_host         varchar(255),
    syslog_port         integer,
    syslog_protocol     varchar(10) Default 'tls',

    s3_bucket           varchar(255),
    s3_prefix           varchar(500),
    s3_key_id           varchar(255),
    s3_secret_id        varchar(255),

    batch_size          integer Default 100,
    flush_interval_ms   integer Default 30000,

    last_sync           timestamp,

    created_by          varchar(64),
    created_at          timestamp Not Null Default now(),
    updated_at          timestamp Not Null Default now()
);

Create Index If Not Exists siem_config_tenant_enabled On siem_config(tenant_id, enabled);
Create Index If Not Exists siem_config_segment_tenant On siem_config(segment_id, tenant_id);

-- ============================================================================
-- 9. Audit retention settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_retention_policy (
    id                  uuid Primary Key Default gen_random_uuid(),
    tenant_id           integer Not Null REFERENCES tenants(id) On Delete Cascade,

    retention_days      integer Not Null Default 90,
    archive_after_days  integer,

    created_at          timestamp Not Null Default now(),
    updated_at          timestamp Not Null Default now()
);

-- ============================================================================
-- 10. Comments
-- ============================================================================
Comment On Table governance_policy_packs Is 'Tenant/segment/project-scoped policy packs and rules for governance audit';
Comment On Table governance_audit_runs Is 'Audit run results with gate verdicts and summary metrics';
Comment On Table governance_findings Is 'Individual findings with triage status and risk acceptance';
Comment On Table audit_log Is 'Immutable append-only log of all auditable security events';
Comment On Table governance_audit_history Is 'Public integrity spine (hash chain), surface /api/audit/verify';
Comment On Table siem_config Is 'Configurations for SIEM export (Webhook, Syslog, S3)';
Comment On Table audit_retention_policy Is 'Audit log retention settings on a per-tenant basis';