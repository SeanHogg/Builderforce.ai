-- 0357_web_security_scans.sql
-- External website security scan — the "point at your live site, get findings now"
-- capability. Reuses the existing security-audit ledger + finding→SECURITY-ticket
-- pipeline (SecurityAuditService, migrations 0290/0291) rather than standing up a
-- second parallel findings surface: one board, one severity vocabulary, one audit
-- history. The only thing a URL scan needs that a codebase audit does not is (a) a
-- notion of WHICH url was scanned and (b) a posture score, so this migration adds
-- exactly those, plus the per-project configured target the user sets once.
--
-- Three additive, nullable/defaulted columns — safe on live tables, no backfill,
-- every existing security_audits row keeps today's behaviour (scan_kind defaults to
-- 'codebase', which is what every pre-existing run was).

-- 1. Distinguish a web (URL) scan run from a codebase (SOC 2) audit run, and record
--    the scanned origin + the computed posture score (0..100) on the run itself.
--    listAudits/getAudit already `SELECT *`, so these surface with no query change.
ALTER TABLE security_audits
  ADD COLUMN IF NOT EXISTS scan_kind  varchar(16) NOT NULL DEFAULT 'codebase', -- 'codebase' | 'web'
  ADD COLUMN IF NOT EXISTS target_url varchar(2048),                            -- the scanned URL (web scans)
  ADD COLUMN IF NOT EXISTS score      integer;                                  -- posture score 0..100 (web scans)

-- History for the web-scan panel + baseline/drift lookup: the latest scans for a
-- tenant of a given kind, newest first.
CREATE INDEX IF NOT EXISTS idx_security_audits_tenant_kind
  ON security_audits(tenant_id, scan_kind, started_at DESC);

-- 2. The website a project is configured to scan (set once, re-scanned on demand).
--    Nullable: a project with no configured target simply has nothing to scan yet.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS security_target_url varchar(2048);
