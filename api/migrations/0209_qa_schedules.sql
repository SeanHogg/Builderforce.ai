-- Migration: QA schedules — make the Agentic Tester a scheduled platform agent.
--
-- The frequent cron sweep (runQaExplorationSweep) enqueues an exploration for
-- every enabled schedule whose next_run_at has elapsed, then re-arms next_run_at
-- from the cron expression. This replaces "run it from a GitHub Action" with a
-- platform-driven cadence the user configures per project.

CREATE TABLE IF NOT EXISTS qa_schedules (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID         REFERENCES segments(id) ON DELETE CASCADE,
  project_id    INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_id     UUID         REFERENCES qa_targets(id) ON DELETE SET NULL,
  credential_id UUID         REFERENCES qa_credentials(id) ON DELETE SET NULL,
  cron          VARCHAR(120) NOT NULL,
  timezone      VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  heat_budget   INTEGER      NOT NULL DEFAULT 20,
  since_days    INTEGER      NOT NULL DEFAULT 30,
  next_run_at   TIMESTAMP,
  last_run_at   TIMESTAMP,
  last_status   VARCHAR(24),
  created_by    VARCHAR(36),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_qa_schedules_segment ON qa_schedules;
CREATE TRIGGER trg_qa_schedules_segment BEFORE INSERT ON qa_schedules FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- Hot path for the sweep: enabled schedules due to run.
CREATE INDEX IF NOT EXISTS idx_qa_schedules_due ON qa_schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_qa_schedules_project ON qa_schedules(tenant_id, project_id);
