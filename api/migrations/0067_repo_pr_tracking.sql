-- Migration: Multi-repo associations & PR/branch tracking (Slice 4).
-- A BF project associates with 1..N repos (github|bitbucket|gitlab). Agents
-- code by creating branches and opening PRs; those are tracked and linked back
-- to the originating ticket and PRD for traceability. project_repositories
-- replaces the single-repo binding on projects (which stays for back-compat).

CREATE TABLE IF NOT EXISTS project_repositories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider       VARCHAR(16) NOT NULL,
  host           VARCHAR(255) NOT NULL DEFAULT 'github.com',
  owner          VARCHAR(255) NOT NULL,
  repo           VARCHAR(255) NOT NULL,
  default_branch VARCHAR(255),
  clone_url_https VARCHAR(500),
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  match_hints    TEXT,
  credential_id  UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_repo UNIQUE (project_id, provider, owner, repo)
);
DROP TRIGGER IF EXISTS trg_project_repositories_segment ON project_repositories;
CREATE TRIGGER trg_project_repositories_segment BEFORE INSERT ON project_repositories FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id, is_default);

CREATE TABLE IF NOT EXISTS repo_branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  repo_id     UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  name        VARCHAR(255) NOT NULL,
  base_branch VARCHAR(255),
  created_by  VARCHAR(120),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_repo_branches_segment ON repo_branches;
CREATE TRIGGER trg_repo_branches_segment BEFORE INSERT ON repo_branches FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_repo_branches_repo ON repo_branches(repo_id);

CREATE TABLE IF NOT EXISTS pull_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id             UUID REFERENCES project_repositories(id) ON DELETE SET NULL,
  task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  spec_id             UUID REFERENCES specs(id) ON DELETE SET NULL,
  workflow_id         UUID REFERENCES workflows(id) ON DELETE SET NULL,
  provider            VARCHAR(16) NOT NULL,
  number              INTEGER,
  url                 VARCHAR(500),
  branch_name         VARCHAR(255),
  base_branch         VARCHAR(255),
  status              VARCHAR(16) NOT NULL DEFAULT 'open',
  external_ticket_ref VARCHAR(255),
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_pull_requests_segment ON pull_requests;
CREATE TRIGGER trg_pull_requests_segment BEFORE INSERT ON pull_requests FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_pull_requests_project ON pull_requests(project_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_task ON pull_requests(task_id);
