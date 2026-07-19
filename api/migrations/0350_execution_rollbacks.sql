-- 0350 — rollback story for autonomous runs.
--
-- One row per cloud run that produced repository artifacts (a ticket branch, and
-- optionally a PR). The row snapshots exactly what the run changed so a later
-- revert can (a) prove the branch has not moved underneath it and (b) undo the
-- run without guessing. Same shape as `contributor_merges` (0205): an undo
-- payload, a status that flips once, and a timestamp for the flip.

CREATE TABLE IF NOT EXISTS execution_rollbacks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          uuid REFERENCES segments(id) ON DELETE CASCADE,
  project_id          integer REFERENCES projects(id) ON DELETE SET NULL,
  task_id             integer REFERENCES tasks(id) ON DELETE SET NULL,
  -- SET NULL, not CASCADE: the audit of what a run did must outlive the run row,
  -- and a null execution_id is exactly the "world changed underneath" signal the
  -- revert refuses on (mirrors contributor_merges' nullable participants).
  execution_id        integer REFERENCES executions(id) ON DELETE SET NULL,
  repo_id             uuid REFERENCES project_repositories(id) ON DELETE SET NULL,
  provider            varchar(16),
  branch_name         varchar(255),
  base_branch         varchar(255),
  pr_row_id           uuid REFERENCES pull_requests(id) ON DELETE SET NULL,
  undo_payload        jsonb,
  -- 'active' | 'reverted' | 'torn_down' | 'refused'
  status              varchar(16) NOT NULL DEFAULT 'active',
  refusal_code        varchar(32),
  refusal_reason      text,
  reverted_by_user_id varchar(36),
  created_at          timestamptz NOT NULL DEFAULT now(),
  reverted_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_execution_rollbacks_execution ON execution_rollbacks(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_rollbacks_tenant_status ON execution_rollbacks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_rollbacks_task ON execution_rollbacks(task_id);
