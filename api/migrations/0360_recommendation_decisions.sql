-- Migration 0360: Add recommendation decision tracking and workflow bindings
-- This migration implements accept/reject functionality for recommendations
-- and defines workflow execution tracking.

-- Table to store recommendation accept/reject decisions (replaces/dismissals)
CREATE TABLE IF NOT EXISTS recommendation_decisions (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL CHECK (tenant_id > 0),
  rec_key         VARCHAR(120) NOT NULL,
  decision        VARCHAR(20) NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  decided_by      VARCHAR(36),
  decided_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rationale       TEXT,
  workflow_trigger_ids JSONB,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'succeeded', 'failed')),
  retry_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_rec_key (tenant_id, rec_key),
  INDEX idx_decided_at (decided_at DESC),
  INDEX idx_status (status),
  CONSTRAINT recommendation_decisions_unique_tenant_rec UNIQUE (tenant_id, rec_key)
);

-- Table to store workflow bindings (admin-configured)
CREATE TABLE IF NOT EXISTS recommendation_workflows (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL CHECK (tenant_id > 0),
  rec_type        VARCHAR(100) NOT NULL,
  event_name      VARCHAR(50) NOT NULL CHECK (event_name IN ('on_accept', 'on_reject', 'on_either')),
  workflow_type   VARCHAR(50) NOT NULL CHECK (workflow_type IN ('webhook', 'internal')),
  workflow_name   VARCHAR(200) NOT NULL,
  workflow_config JSONB NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_rec_type (tenant_id, rec_type),
  INDEX idx_event (event_name),
  CONSTRAINT recommendation_workflows_unique_tenant_type_event UNIQUE (tenant_id, rec_type, event_name)
);

-- Table to store workflow execution history
CREATE TABLE IF NOT EXISTS workflow_executions (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL CHECK (tenant_id > 0),
  decision_id     INTEGER NOT NULL REFERENCES recommendation_decisions(id) ON DELETE CASCADE,
  workflow_id     INTEGER NOT NULL,
  workflow_config JSONB NOT NULL,
  trigger_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status          VARCHAR(20) NOT NULL CHECK (status IN ('triggered', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt         INTEGER NOT NULL DEFAULT 1,
  result          JSONB,
  request_payload JSONB NOT NULL,
  response_body   TEXT,
  response_status INTEGER,
  error_message   TEXT,
  retry_strategy  JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_decision (decision_id),
  INDEX idx_status (status),
  INDEX idx_workflow_id (workflow_id)
);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_recommendation_decisions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER recommendation_decisions_updated_at
  BEFORE UPDATE ON recommendation_decisions
  FOR EACH ROW
  EXECUTE FUNCTION update_recommendation_decisions_updated_at();

-- Add a view for admin dashboard (optional)
CREATE OR REPLACE VIEW recommendation_decisions_admin AS
SELECT
  rd.id,
  rd.tenant_id,
  rd.rec_key,
  r.key || ' → ' || rd.decision AS recommendation_key,
  rd.decision,
  rd.decided_by,
  rd.decided_at,
  rd.rationale,
  rd.status,
  rd.retry_count,
  wd.rec_type,
  wd.event_name,
  wd.workflow_name,
  from_json(rd.workflow_trigger_ids) AS trigger_ids
FROM recommendation_decisions rd
LEFT JOIN limbo_recommendations r ON r.key = rd.rec_key
LEFT JOIN recommendation_workflows wd ON wd.tenant_id = rd.tenant_id AND wd.rec_type = r.key
ORDER BY rd.decided_at DESC;

COMMENT ON TABLE recommendation_decisions IS 'Stores accept/reject decisions for recommendations and tracks workflow execution status';
COMMENT ON TABLE recommendation_workflows IS 'Admin-configured workflow bindings per recommendation type and event';
COMMENT ON TABLE workflow_executions IS 'Detailed history of workflow triggers and execution results';
COMMENT ON COLUMN recommendation_decisions.decision IS 'accepted or rejected';
COMMENT ON COLUMN recommendation_decisions.rationale IS 'Optional rationalle (max 500 chars)';
COMMENT ON COLUMN recommendation_decisions.workflow_trigger_ids IS 'Array of trigger IDs for workflows that executed';
COMMENT ON COLUMN recommendation_decisions.status IS 'pending, triggered, succeeded, failed';
COMMENT ON COLUMN workflow_executions.status IS 'triggered, running, succeeded, failed, cancelled';

-- Insert sample workflow bindings for common recommendation types (optional)
INSERT INTO recommendation_workflows (tenant_id, rec_type, event_name, workflow_type, workflow_name, workflow_config) VALUES
-- Cost recommendations
(1, 'cost.budget_over', 'on_accept', 'internal', 'Budget Cap Alert', '{"type": "slack", "channel": "finance-alerts"}'::jsonb),
(1, 'cost.per_pr_spike', 'on_accept', 'webhook', 'Cost Optimization Webhook', '{"url": "https://api.example.com/cost-optimization"}'::jsonb),
(1, 'cost.budget_over', 'on_reject', 'internal', 'Budget Review Configuration', '{"type": "email", "template_id": "budget-review"}'::jsonb),

-- Quality recommendations
(1, 'quality.low_merge_rate', 'on_accept', 'internal', 'Quality Improvement Task', '{"type": "task_creation", "assignee_default": "engineering-lead"}'::jsonb),
(1, 'quality.model_low_merge.claude', 'on_accept', 'webhook', 'Model Performance Webhook', '{"url": "https://api.example.com/model-perf"}'::jsonb),
(1, 'quality.low_merge_rate', 'on_reject', 'internal', 'Quality Review Team', '{"type": "email", "recipients": ["dev-lead", "pm"]}'),

-- Delivery recommendations
(1, 'delivery.high_cfr', 'on_accept', 'internal', 'Deployment Safety Check', '{"type": "slack", "channel": "devops-alerts"}'::jsonb),
(1, 'delivery.high_mttr', 'on_accept', 'webhook', 'MTTR Alert', '{"url": "https://api.example.com/mttr-alert"}'::jsonb);