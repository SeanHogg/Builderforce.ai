-- Consolidate the coordination-specific event stream into the kernel activity log.
-- The temporary source-table creation keeps this migration safe when 0444 was not
-- applied to an older environment; ON CONFLICT makes a retry idempotent.
CREATE TABLE IF NOT EXISTS coordination_contention_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_key VARCHAR(255) NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  resource_key VARCHAR(512) NOT NULL,
  claimant_execution_id INTEGER,
  holder_execution_id INTEGER,
  claimant_label VARCHAR(255) NOT NULL,
  holder_label VARCHAR(255) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO activity_log (
  event_key,
  tenant_id,
  actor_type,
  actor_name,
  verb,
  target_type,
  target_id,
  target_label,
  metadata,
  occurred_at,
  created_at
)
SELECT
  'coordination-contention:' || id,
  tenant_id,
  'system',
  'System',
  'coordination.lease_contended',
  'coordination_scope',
  LEFT(scope_key, 64),
  LEFT(resource_key, 300),
  jsonb_build_object(
    'scopeKey', scope_key,
    'taskId', task_id,
    'resourceKey', resource_key,
    'claimantExecutionId', claimant_execution_id,
    'holderExecutionId', holder_execution_id,
    'claimantLabel', claimant_label,
    'holderLabel', holder_label
  ),
  occurred_at,
  occurred_at
FROM coordination_contention_events
ON CONFLICT (event_key) DO NOTHING;

DROP TABLE coordination_contention_events;

CREATE INDEX IF NOT EXISTS idx_activity_log_coordination_scope
  ON activity_log (tenant_id, (metadata ->> 'scopeKey'), occurred_at DESC)
  WHERE verb = 'coordination.lease_contended';
