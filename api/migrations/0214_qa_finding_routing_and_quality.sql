-- 0214_qa_finding_routing_and_quality.sql
--
-- Two QA capability closures on top of the Agentic Tester (0206):
--
--   1. Auto-route findings to a fix agent. Today a finding only becomes a board
--      task when a human clicks "Create task", and only auto-runs once the ticket
--      is dragged into a staffed lane — so findings "land in the backlog". This
--      adds an OPT-IN per-project routing policy: when an exploration captures a
--      finding at/above `min_severity`, the platform opens the board task AND
--      moves it into the project's auto-fix lane, firing the SAME lane auto-run
--      trigger the board drag uses (no new dispatch path).
--
--   2. Quality trend per project. The findings + CI build outcomes + per-run model
--      outcomes already exist; the read side needs indexes to roll them up by
--      project and window (QaQualityService). qa_findings already indexes
--      (tenant_id, created_at); add the project-scoped variants the trend reads.
--
-- Tenant-scoped; segment defaulted by the 0056 trigger. Idempotent / re-runnable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qa_routing_settings — per-project finding → fix-agent routing policy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_routing_settings (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID         REFERENCES segments(id) ON DELETE CASCADE,
  -- One policy per project (the auto-route decision is project-scoped because the
  -- fix lane + its staffed agent live on the project's board).
  project_id       INTEGER      NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  -- Master switch. Default OFF: auto-routing dispatches paid agent runs, so it is
  -- opt-in per project rather than a surprise the moment the tester finds an error.
  enabled          BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Minimum severity that triggers a route ('low' | 'medium' | 'high' | 'critical').
  min_severity     VARCHAR(16)  NOT NULL DEFAULT 'high',
  -- Explicit board lane key to route into. NULL = auto-detect the first non-terminal
  -- lane with a non-human gate AND a staffed agent (the natural "fix" lane).
  target_lane_key  VARCHAR(120),
  -- Safety cap: max findings auto-routed per exploration batch (prevents a noisy
  -- run from spawning dozens of agent runs at once).
  max_per_batch    INTEGER      NOT NULL DEFAULT 5,
  created_by       VARCHAR(36),
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_routing_settings_segment ON qa_routing_settings;
CREATE TRIGGER trg_qa_routing_settings_segment BEFORE INSERT ON qa_routing_settings FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_routing_settings_tenant ON qa_routing_settings(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Finding provenance + quality-trend read indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Did this finding get auto-routed (vs a manual "Create task")? Lets the trend
-- and the UI distinguish autonomous remediation from human triage.
ALTER TABLE qa_findings ADD COLUMN IF NOT EXISTS auto_routed BOOLEAN NOT NULL DEFAULT FALSE;

-- Quality trend reads are project + window scoped; the existing indexes are
-- tenant-scoped. These back the per-project severity/daily rollups.
CREATE INDEX IF NOT EXISTS idx_qa_findings_project_created  ON qa_findings(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qa_findings_project_severity ON qa_findings(project_id, severity);

-- Cross-exploration dedupe: before opening a fix task for a finding, look up an
-- existing OPEN task for an equivalent finding (same project + fingerprint) so the
-- same recurring error captured in two runs reuses one ticket instead of spawning
-- duplicates. Backs QaFindingRouter.findReusableTask().
CREATE INDEX IF NOT EXISTS idx_qa_findings_project_fingerprint ON qa_findings(project_id, fingerprint);

-- The "which model/agent produced the defects" rollup reads run_model_outcomes by
-- (project_id, created_at) and pull_requests by (project_id, build_status). Add the
-- former; pull_requests build outcomes are already covered by project indexes.
CREATE INDEX IF NOT EXISTS idx_run_model_outcomes_project_created ON run_model_outcomes(project_id, created_at);
