-- Risk Mitigation Action Engine schema
-- Add tables for tracking risks and their mitigation actions.
-- RO: risk_records, risk_mitigation_actions; no optional fields beyond project_id.

BEGIN;

-- -------------------------------------------------
-- Risk Records table (RO, no optional fields)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_records (
  id                          SERIAL PRIMARY KEY,
  tenant_id                   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id                  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_type                   VARCHAR(50) NOT NULL, /* overdue_task | budget_overrun | blocked_dependency | under_resourced */
  severity                    VARCHAR(20) NOT NULL, /* critical | high | medium | low */
  description                 TEXT NOT NULL,
  affected_entities           TEXT,                   -- JSON array of affected entity refs (task_id, budget_line_id, predecessor_task_id)
  context_snapshot            TEXT NOT NULL,          -- JSON object capturing detection context
  detection_timestamp         TIMESTAMP NOT NULL,     -- time when risk was detected
  first_seen_at               TIMESTAMP NOT NULL,     -- first time we observed this risk instance
  last_seen_at                TIMESTAMP NOT NULL,     -- last time we observed this risk instance (including live updates)
  mitigation_status           VARCHAR(30) NOT NULL,   /* open | mitigating | resolved | escalated | suppressed */
  auto_execute_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Indexes for filters and performance
  CONSTRAINT risk_records_project_tenant UNIQUE (project_id, tenant_id, risk_type, severity, detection_timestamp)
);

-- Graft index for risk_type + severity across projects per tenant (hot query path)
CREATE INDEX IF NOT EXISTS risk_records_type_severity_tenant_ctx_idx
  ON risk_records(tenant_id, project_id, risk_type, severity, risk_records.created_at DESC);

-- Index for date filters (startup gate, monitoring, reports)
CREATE INDEX IF NOT EXISTS risk_records_date_filter_idx
  ON risk_records(tenant_id, detection_timestamp, first_seen_at);

-- Index for lookup by affected entity (caller uses given task_id or budget_line_id)
CREATE INDEX IF NOT EXISTS risk_records_entity_idx
  ON risk_records(tenant_id, affected_entities);

-- Index for mitigation_status for queries that track open/mitigating risks
CREATE INDEX IF NOT EXISTS risk_records_mitigation_status_idx
  ON risk_records(tenant_id, mitigation_status, project_id);

-- Trigger to keep updated_at current (same pattern as alerts migration)
CREATE OR REPLACE FUNCTION risk_updated_at_trg()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS risk_updated_at_trg_trigger ON risk_records;
CREATE TRIGGER risk_updated_at_trg_trigger
  BEFORE UPDATE OF updated_at ON risk_records
  FOR EACH ROW EXECUTE FUNCTION risk_updated_at_trg();

-- -------------------------------------------------
-- Risk Mitigation Actions table (RO, no optional fields)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_mitigation_actions (
  id                            SERIAL PRIMARY KEY,
  risk_id                       INTEGER NOT NULL REFERENCES risk_records(id) ON DELETE CASCADE,
  tenant_id                     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id                    INTEGER NOT NULL REFERENCES projects(id) ON DELETE SET NULL,
  type                          VARCHAR(50) NOT NULL, /* re_prioritize | extend_deadline | split_task | reassign | escalate | flag_executive | defer_non_critical | reallocate_budget | reduce_compute | halt_discretionary | fast_track | begin_parallel_prep | request_human_assignment | request_notification | split_workload | defer_start_date */
  target_entity                 VARCHAR(255) NOT NULL, -- exact: task_id OR budget_line_id OR predecessor_task_id
  rationale                     TEXT NOT NULL,
  estimated_effort              VARCHAR(20) NOT NULL, /* low | medium | high */
  auto_executable               BOOLEAN NOT NULL,
  status                        VARCHAR(30) NOT NULL, /* generated | accepted | in_progress | rejected | executing | executed | failed */
  auto_execute_enabled          BOOLEAN,           -- optional: per-project override
  created_at                    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Indexes for filters and performance
  CONSTRAINT risk_mitigation_actions_risk UNIQUE (risk_id, type)
);

-- Indexes for SUS queries and filtering
CREATE INDEX IF NOT EXISTS risk_mitigation_actions_risk_id_idx
  ON risk_mitigation_actions(risk_id);

CREATE INDEX IF NOT EXISTS risk_mitigation_actions_type_idx
  ON risk_mitigation_actions(type);

CREATE INDEX IF NOT EXISTS risk_mitigation_actions_status_idx
  ON risk_mitigation_actions(status);

CREATE INDEX IF NOT EXISTS risk_mitigation_actions_project_idx
  ON risk_mitigation_actions(project_id) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS risk_mitigation_actions_tenant_ctx_idx
  ON risk_mitigation_actions(tenant_id, project_id, risk_mitigation_actions.created_at DESC);

CREATE INDEX IF NOT EXISTS risk_mitigation_actions_target_entity_idx
  ON risk_mitigation_actions(target_entity);

-- Ensure reference integrity won’t corrupt the loop.
DROP TRIGGER IF EXISTS risk_analytics_trg ON risk_records;
CREATE TRIGGER risk_analytics_trg
  AFTER INSERT ON risk_records
  FOR EACH ROW EXECUTE FUNCTION risk_updated_at_trg();

COMMIT;