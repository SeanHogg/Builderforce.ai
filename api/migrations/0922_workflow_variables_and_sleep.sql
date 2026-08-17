-- Backs the new workflow-builder Tools node kinds: set-variable / get-variable
-- (scope='run', scope_id=a workflows.id) and increment (scope='definition',
-- scope_id=a workflow_definitions.id, so the counter persists across runs).
-- One fact per row (3NF): a single generic scope/scope_id pair rather than two
-- nullable FK columns, since a row belongs to exactly one scope kind.
CREATE TABLE IF NOT EXISTS workflow_variables (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- 'run' | 'definition'.
  scope      varchar(16) NOT NULL,
  scope_id   varchar(64) NOT NULL,
  key        varchar(255) NOT NULL,
  value      text NOT NULL DEFAULT '',
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_variables_scope_key ON workflow_variables (scope, scope_id, key);
CREATE INDEX IF NOT EXISTS idx_workflow_variables_tenant ON workflow_variables (tenant_id);

-- Backs the Tools `sleep` node kind: set on first visit (now + delaySeconds);
-- the cloud dispatcher's readiness gate holds the task until this passes.
ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS not_before timestamp;
