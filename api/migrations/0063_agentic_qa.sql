-- Migration: Agentic QA — usage capture → AI test generation → browser run results.
--
-- Pipeline: qa_journey_events (raw client interactions) → qa_flows (normalized
-- flows) → qa_tests (AI-generated Playwright specs) → qa_runs / qa_run_steps
-- (execution results posted back by the CI harness).
--
-- Tenant-scoped tables are segment-scoped with the 0056 trigger
-- (set_default_segment_id). qa_run_steps is a child of qa_runs and carries no
-- segment_id of its own.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qa_journey_events — raw client-side interaction telemetry
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_journey_events (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID        REFERENCES segments(id) ON DELETE CASCADE,
  user_id     VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  session_id  VARCHAR(64) NOT NULL,
  seq         INTEGER     NOT NULL DEFAULT 0,
  type        VARCHAR(32) NOT NULL,
  route       VARCHAR(512),
  selector    TEXT,
  label       VARCHAR(255),
  value       VARCHAR(255),
  meta        TEXT,
  ts          TIMESTAMP   NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_journey_events_segment ON qa_journey_events;
CREATE TRIGGER trg_qa_journey_events_segment BEFORE INSERT ON qa_journey_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_journey_events_tenant_session ON qa_journey_events(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_qa_journey_events_tenant_route   ON qa_journey_events(tenant_id, route);
CREATE INDEX IF NOT EXISTS idx_qa_journey_events_tenant_ts      ON qa_journey_events(tenant_id, ts);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. qa_flows — normalized flows to test (usage-derived / crawl / manual)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_flows (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID         REFERENCES segments(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  slug         VARCHAR(255) NOT NULL,
  source       VARCHAR(16)  NOT NULL DEFAULT 'usage',
  description  TEXT,
  start_route  VARCHAR(512),
  steps        TEXT,
  frequency    INTEGER      NOT NULL DEFAULT 0,
  status       VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT qa_flows_tenant_slug_uniq UNIQUE (tenant_id, slug)
);
DROP TRIGGER IF EXISTS trg_qa_flows_segment ON qa_flows;
CREATE TRIGGER trg_qa_flows_segment BEFORE INSERT ON qa_flows FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_flows_tenant_status ON qa_flows(tenant_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. qa_tests — AI-generated Playwright specs (versioned, one per flow)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_tests (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID         REFERENCES segments(id) ON DELETE CASCADE,
  flow_id      UUID         REFERENCES qa_flows(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  slug         VARCHAR(255) NOT NULL,
  framework    VARCHAR(16)  NOT NULL DEFAULT 'playwright',
  spec         TEXT         NOT NULL,
  steps_model  TEXT,
  model        VARCHAR(255),
  generated_by VARCHAR(36),
  version      INTEGER      NOT NULL DEFAULT 1,
  status       VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT qa_tests_tenant_slug_uniq UNIQUE (tenant_id, slug)
);
DROP TRIGGER IF EXISTS trg_qa_tests_segment ON qa_tests;
CREATE TRIGGER trg_qa_tests_segment BEFORE INSERT ON qa_tests FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_tests_tenant_status ON qa_tests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_qa_tests_flow          ON qa_tests(flow_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. qa_runs — execution results posted back by the CI harness
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_runs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID         REFERENCES segments(id) ON DELETE CASCADE,
  test_id         UUID         REFERENCES qa_tests(id) ON DELETE SET NULL,
  run_key         VARCHAR(64),
  trigger         VARCHAR(16)  NOT NULL DEFAULT 'ci',
  status          VARCHAR(16)  NOT NULL DEFAULT 'queued',
  browser         VARCHAR(32),
  target_url      VARCHAR(512),
  commit_sha      VARCHAR(64),
  duration_ms     INTEGER,
  total_steps     INTEGER,
  passed_steps    INTEGER,
  error_message   TEXT,
  screenshot_keys TEXT,
  logs            TEXT,
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_runs_segment ON qa_runs;
CREATE TRIGGER trg_qa_runs_segment BEFORE INSERT ON qa_runs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_qa_runs_tenant_created ON qa_runs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qa_runs_test           ON qa_runs(test_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_run_key        ON qa_runs(run_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. qa_run_steps — per-step granularity within a run (no segment_id; child of run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_run_steps (
  id             SERIAL PRIMARY KEY,
  run_id         UUID        NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  seq            INTEGER     NOT NULL DEFAULT 0,
  action         VARCHAR(32) NOT NULL,
  selector       TEXT,
  status         VARCHAR(16) NOT NULL,
  duration_ms    INTEGER,
  error_message  TEXT,
  screenshot_key VARCHAR(512),
  created_at     TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qa_run_steps_run ON qa_run_steps(run_id);
