-- 0206_agentic_tester.sql
--
-- Heatmap-driven Agentic Tester — the autonomous, exploratory half of Agentic QA.
--
-- The existing pipeline (0063/0068) REPLAYS recorded flows. This adds an agent
-- that DECIDES what to exercise from interaction *heat*: the per-(route,selector)
-- frequency already captured in qa_journey_events. A containerised harness pulls
-- a heat-derived plan, drives a real browser through the hottest zones, captures
-- runtime errors (console / pageerror / failed request / assertion / crash), and
-- feeds each one back as a finding that can spawn a board task for an agent to fix.
--
--   qa_explorations — one exploratory tester session (the run). Carries the
--     heat-derived plan it executed and the rolled-up outcome.
--   qa_findings     — one captured runtime error within an exploration, ranked by
--     the heat of the zone it surfaced in, optionally linked to the board task
--     opened to fix it.
--
-- Tenant-scoped tables are segment-scoped with the 0056 trigger
-- (set_default_segment_id). Idempotent / re-runnable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qa_explorations — an agentic exploratory tester session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_explorations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID         REFERENCES segments(id) ON DELETE CASCADE,
  -- Project (site-under-test). Null = workspace-level self-test (Builderforce app).
  project_id      INTEGER      REFERENCES projects(id) ON DELETE CASCADE,
  target_id       UUID         REFERENCES qa_targets(id) ON DELETE SET NULL,
  -- Persona the exploration runs as (project mode).
  credential_id   UUID         REFERENCES qa_credentials(id) ON DELETE SET NULL,
  -- 'queued' | 'running' | 'passed' | 'failed' | 'error'
  status          VARCHAR(16)  NOT NULL DEFAULT 'queued',
  trigger         VARCHAR(16)  NOT NULL DEFAULT 'manual',  -- 'manual' | 'ci' | 'cron'
  -- Max number of hot zones the agent will exercise this run.
  heat_budget     INTEGER      NOT NULL DEFAULT 20,
  -- Heat window: how many days of journey events feed the ranking.
  since_days      INTEGER      NOT NULL DEFAULT 30,
  -- The heat-derived plan the harness executes (JSON QaStep[]).
  plan            TEXT,
  -- Snapshot of the ranked heat zones the plan was built from (JSON, for display
  -- + finding provenance).
  heat_zones      TEXT,
  -- LLM that ordered the plan (null = deterministic heat ordering).
  model           VARCHAR(255),
  zones_planned   INTEGER      NOT NULL DEFAULT 0,
  zones_explored  INTEGER,
  findings_count  INTEGER      NOT NULL DEFAULT 0,
  run_key         VARCHAR(64),
  browser         VARCHAR(32),
  target_url      VARCHAR(512),
  commit_sha      VARCHAR(64),
  summary         TEXT,
  error_message   TEXT,
  created_by      VARCHAR(36),
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_explorations_segment ON qa_explorations;
CREATE TRIGGER trg_qa_explorations_segment BEFORE INSERT ON qa_explorations FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_explorations_tenant_created ON qa_explorations(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qa_explorations_tenant_status  ON qa_explorations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_qa_explorations_project        ON qa_explorations(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. qa_findings — runtime errors captured during an exploration
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_findings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  exploration_id  UUID         NOT NULL REFERENCES qa_explorations(id) ON DELETE CASCADE,
  tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID         REFERENCES segments(id) ON DELETE CASCADE,
  project_id      INTEGER      REFERENCES projects(id) ON DELETE CASCADE,
  -- 'console' | 'pageerror' | 'network' | 'assertion' | 'crash' | 'navigation'
  type            VARCHAR(24)  NOT NULL,
  -- 'low' | 'medium' | 'high' | 'critical'
  severity        VARCHAR(16)  NOT NULL DEFAULT 'medium',
  route           VARCHAR(512),
  selector        TEXT,
  message         TEXT         NOT NULL,
  detail          TEXT,        -- stack trace / failed-response body / extra JSON
  -- Interaction frequency of the zone this surfaced in — why the finding matters.
  heat            INTEGER      NOT NULL DEFAULT 0,
  screenshot_key  VARCHAR(512),
  -- 'open' | 'triaged' | 'task_created' | 'ignored' | 'resolved'
  status          VARCHAR(16)  NOT NULL DEFAULT 'open',
  -- Board task opened to fix this finding (feedback loop).
  task_id         INTEGER      REFERENCES tasks(id) ON DELETE SET NULL,
  -- Dedupe key within a run (type + route + selector + message hash).
  fingerprint     VARCHAR(64),
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT qa_findings_exploration_fingerprint_uniq UNIQUE (exploration_id, fingerprint)
);
DROP TRIGGER IF EXISTS trg_qa_findings_segment ON qa_findings;
CREATE TRIGGER trg_qa_findings_segment BEFORE INSERT ON qa_findings FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_findings_exploration   ON qa_findings(exploration_id);
CREATE INDEX IF NOT EXISTS idx_qa_findings_tenant_created ON qa_findings(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qa_findings_tenant_status  ON qa_findings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_qa_findings_task           ON qa_findings(task_id);
