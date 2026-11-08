-- 1322 · governance-auditor gaps, and a record of what a data-subject request execution did.
--
-- governance_audit_gaps. The governance-auditor sweep (application/governance/governanceAuditor.ts)
-- flags two kinds of gap per tenant segment: a merged pull request that was never security-scanned
-- or reviewed, and a SOC 2 control with no evidence in the last 90 days. A gap is an OPEN question
-- the SOC 2 page shows, not evidence — which is why it is not a soc_evidence row (the evidence
-- export would hand an auditor a "gap" as if it were proof). One row per (segment, gap_type,
-- subject_ref): the sweep upserts, and resolves the row when the gap closes.
--
-- data_subject_requests.execution_result. What executing a DSR for its Segment actually did (rows
-- exported / suppressed / erased per store) as JSON text, so "fulfilled" is never an unexplained status.
--
-- Expand-only: one new table, one new nullable column.
CREATE TABLE IF NOT EXISTS governance_audit_gaps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  gap_type    VARCHAR(40) NOT NULL,
  subject_ref VARCHAR(120) NOT NULL,
  control_id  UUID REFERENCES soc_controls(id) ON DELETE CASCADE,
  detail      TEXT,
  status      VARCHAR(16) NOT NULL DEFAULT 'open',
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_governance_audit_gaps_subject
  ON governance_audit_gaps(tenant_id, segment_id, gap_type, subject_ref);
CREATE INDEX IF NOT EXISTS idx_governance_audit_gaps_open
  ON governance_audit_gaps(tenant_id, segment_id, status);

ALTER TABLE data_subject_requests ADD COLUMN IF NOT EXISTS execution_result TEXT;

-- pr_security_overrides. A MANAGER's explicit, reasoned acceptance of the security risk of ONE pull
-- request at ONE head commit, so a PR the scanners cannot fully cover (too large, a broken scanner) is
-- not held forever. The merge gate honours a row only for the PR's current head_sha: a later push is a
-- new commit and needs a new decision. Audited through the governance mutation envelope on write.
CREATE TABLE IF NOT EXISTS pr_security_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  pull_request_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  head_sha        VARCHAR(64) NOT NULL,
  reason          TEXT NOT NULL,
  accepted_by     VARCHAR(64),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_security_overrides_pr_sha
  ON pr_security_overrides(pull_request_id, head_sha);
