-- Evermind learning pipeline (roadmap 07bc5793).
--
-- The weight store and the project-facts store already exist. What did not is the
-- product layer the four key results are measured on: a baseline snapshot, one row
-- per text-learn run, and a human-reviewable candidate that can be approved and
-- transferred back into project_facts. These tables are that ledger. They do not
-- replace project_evermind or project_facts.

CREATE TABLE IF NOT EXISTS evermind_learning_baselines (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  head_version  integer NOT NULL DEFAULT 0,
  facts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  fact_count    integer NOT NULL DEFAULT 0,
  captured_at   timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evermind_learning_baseline_project
  ON evermind_learning_baselines (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS evermind_learning_runs (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  head_version  integer NOT NULL DEFAULT 0,
  produced      boolean NOT NULL DEFAULT false,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evermind_learning_runs_project
  ON evermind_learning_runs (tenant_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS evermind_learning_candidates (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id            integer NOT NULL REFERENCES evermind_learning_runs(id) ON DELETE CASCADE,
  statement         text NOT NULL,
  fact_key          varchar(120) NOT NULL,
  baseline_content  text,
  contradicts       boolean NOT NULL DEFAULT false,
  status            varchar(16) NOT NULL DEFAULT 'pending',
  created_at        timestamp NOT NULL DEFAULT now(),
  reviewed_at       timestamp,
  reviewed_by       varchar(36),
  transferred_at    timestamp,
  bench_before      real,
  bench_after       real,
  CONSTRAINT evermind_learning_candidates_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_evermind_learning_candidates_project
  ON evermind_learning_candidates (tenant_id, project_id, status, created_at);
