-- Dedicated PR/ticket reconciliation agent plus its durable diagnostic ledger.
-- The reconciler is dry-run by default; individual destructive actions require an
-- explicit approved PR-number allowlist at invocation time.

INSERT INTO ide_agents (
  id, tenant_id, name, title, bio, skills, base_model, status,
  runtime_support, published, price_cents, builtin_kind
)
SELECT
  'pr-reconciler-t' || t.id,
  t.id,
  'PR/Ticket Reconciler',
  'PR/Ticket Reconciler — audits GitHub delivery state against BuilderForce tickets',
  'Reconciles open pull requests with their BuilderForce tickets and execution evidence. Separates shared infrastructure failures from change-specific failures, records an evidence-backed recommendation for every pull request, and never closes work merely because CI is red. Destructive actions require an explicit per-PR approval allowlist. Every collection, classification, and action error is retained in the reconciliation diagnostics ledger.',
  '["github","pull-request-triage","ticket-reconciliation","ci-diagnostics","delivery-governance"]',
  'builderforce-default', 'active', 'cloud', false, 0, 'pr_reconciler'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a
  WHERE a.tenant_id = t.id AND a.builtin_kind = 'pr_reconciler'
);

CREATE TABLE IF NOT EXISTS pr_reconciliation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id             UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  agent_ref           VARCHAR(64),
  mode                VARCHAR(16) NOT NULL DEFAULT 'dry_run',
  status              VARCHAR(24) NOT NULL DEFAULT 'running',
  requested_by        VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  approved_pr_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary             JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_count         INTEGER NOT NULL DEFAULT 0,
  started_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMP,
  CONSTRAINT ck_pr_reconciliation_run_mode CHECK (mode IN ('dry_run', 'apply')),
  CONSTRAINT ck_pr_reconciliation_run_status CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_pr_reconciliation_runs_repo_started
  ON pr_reconciliation_runs(repo_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_reconciliation_runs_tenant_started
  ON pr_reconciliation_runs(tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS pr_reconciliation_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES pr_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repo_id             UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  pr_number           INTEGER NOT NULL,
  pr_url              VARCHAR(500) NOT NULL,
  title               TEXT NOT NULL,
  head_branch         VARCHAR(255),
  task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_status         VARCHAR(64),
  classification      VARCHAR(32) NOT NULL,
  recommended_action  VARCHAR(32) NOT NULL,
  confidence          VARCHAR(16) NOT NULL,
  reason_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence            JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_action      VARCHAR(32),
  applied_at          TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_pr_reconciliation_items_run_class
  ON pr_reconciliation_items(run_id, classification, pr_number);

CREATE TABLE IF NOT EXISTS pr_reconciliation_errors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID REFERENCES pr_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repo_id     UUID REFERENCES project_repositories(id) ON DELETE SET NULL,
  pr_number   INTEGER,
  phase       VARCHAR(32) NOT NULL,
  code        VARCHAR(64) NOT NULL,
  message     TEXT NOT NULL,
  stack       TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_reconciliation_errors_run_created
  ON pr_reconciliation_errors(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_reconciliation_errors_tenant_created
  ON pr_reconciliation_errors(tenant_id, created_at DESC);
