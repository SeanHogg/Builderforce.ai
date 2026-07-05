-- 0290_task_type_security.sql
-- A fourth task_type value: 'security'. A SECURITY task is minted by the Security
-- agent (the seeded SOC 2 auditor, migration 0291) when it finds an issue during a
-- SOC 2 audit — one first-class, schedulable board ticket per finding, carrying the
-- finding's severity, the Trust Service Criterion it maps to, and the audit run that
-- produced it. It is the exact sibling of the Validator's 'gap' type (migration 0270),
-- but access-restricted: security tickets are filtered by security_ticket_access
-- (migration 0291), visible only to allowlisted / opted-in audiences + Owner/Admin.
--
-- Idempotent / re-runnable: ADD VALUE + ADD COLUMN IF NOT EXISTS. 'security' is only
-- ADDED here (never used as a literal in this file), so it is safe inside the
-- migration runner's single-file transaction — the same rule 0270 followed for 'gap'.

-- 1. SECURITY task type ------------------------------------------------------
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'security';

-- 2. Finding metadata denormalised onto the security task -------------------
--    (the full audit-run rollup lives in security_audits, migration 0291; these
--     render the board badge + audit drawer without a join).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS security_severity VARCHAR(12);   -- 'critical'|'high'|'medium'|'low'|'info'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS security_tsc      VARCHAR(32);   -- Trust Service Criterion (security|availability|processing_integrity|confidentiality|privacy)
-- The security_audits run whose sweep produced this finding (null for a manually
-- filed security ticket). No FK — kept loose like reviewer_ref so a purged audit
-- run never cascades away the finding tickets it produced.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS security_audit_id INTEGER;

-- Audit rollup: find the security tickets born from a given audit run.
CREATE INDEX IF NOT EXISTS idx_tasks_security_audit ON tasks(security_audit_id);
