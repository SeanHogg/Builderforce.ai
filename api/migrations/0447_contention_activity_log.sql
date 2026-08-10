-- Consolidate the coordination-specific event stream into the kernel activity log.
-- Dynamic SQL lets upgraded environments preserve rows from the superseded 0444
-- migration while fresh environments, where the legacy table never existed, skip
-- the copy. ON CONFLICT makes a retry idempotent.
DO $migration$
BEGIN
  IF to_regclass('coordination_contention_events') IS NOT NULL THEN
    EXECUTE $copy$
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
      ON CONFLICT (event_key) DO NOTHING
    $copy$;
    EXECUTE 'DROP TABLE coordination_contention_events';
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_activity_log_coordination_scope
  ON activity_log (tenant_id, (metadata ->> 'scopeKey'), occurred_at DESC)
  WHERE verb = 'coordination.lease_contended';
