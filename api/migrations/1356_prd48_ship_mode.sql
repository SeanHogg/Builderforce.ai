-- 1356 · PRD 48 §4.0 — the project's SHIP MODE (EXPAND only, no drops).
--
-- WHY. An autonomous run that finished its work used to stop and ask a person what to do
-- with it ("a push needs approval", VS Code chat #157440), and the cloud's merge decision
-- read a Cloudflare env flag (`CLOUD_AUTOMERGE_ENABLED`) instead of the project. Operator
-- ruling: every ship and merge decision is a tenant/project setting stored HERE, read and
-- written through the manager config route, the workspace-defaults route and the
-- `manager.configure` MCP tool — never an env var, a secret or a VS Code setting.
--
-- `ship_mode` is what a VS Code (local) run does with finished work:
--   leave_uncommitted | commit | commit_push | pull_request
-- Cloud runs always open a pull request whatever it says; the PR merge sweep decides the
-- merge from `allow_auto_merge` / `pr_merge_policy` / `require_signoff_to_complete`.
--
-- Nullable at BOTH tiers on purpose, like `allow_auto_merge` (0363): NULL means "this tier
-- has no opinion", so a project inherits the workspace default and the workspace falls
-- back to the built-in `commit` (local and reversible). The fold
-- (`application/manager/managerPolicy.ts`) resolves it as a plain override — project beats
-- workspace beats the built-in.
--
-- EXPAND only: nullable columns and a CHECK that every NULL row satisfies. Safe as a
-- single push under the expand/contract rule.

SET LOCAL lock_timeout = '3s';

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS ship_mode varchar(20);

ALTER TABLE tenant_manager_defaults
  ADD COLUMN IF NOT EXISTS ship_mode varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_manager_configs_ship_mode'
  ) THEN
    ALTER TABLE project_manager_configs
      ADD CONSTRAINT chk_project_manager_configs_ship_mode
      CHECK (ship_mode IS NULL OR ship_mode IN ('leave_uncommitted', 'commit', 'commit_push', 'pull_request'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenant_manager_defaults_ship_mode'
  ) THEN
    ALTER TABLE tenant_manager_defaults
      ADD CONSTRAINT chk_tenant_manager_defaults_ship_mode
      CHECK (ship_mode IS NULL OR ship_mode IN ('leave_uncommitted', 'commit', 'commit_push', 'pull_request'));
  END IF;
END $$;

COMMENT ON COLUMN project_manager_configs.ship_mode IS
  'PRD 48: what a local (VS Code) run does with finished work on this project — leave_uncommitted | commit | commit_push | pull_request. NULL = inherit the workspace default. Cloud runs always open a pull request; the PR merge sweep decides merges from the manager policy.';

COMMENT ON COLUMN tenant_manager_defaults.ship_mode IS
  'PRD 48: workspace default for project_manager_configs.ship_mode. NULL = no workspace opinion (the built-in commit applies).';
