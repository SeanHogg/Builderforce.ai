-- 1342 · Run outcomes (PRD 41 §D1, WS16) — the PRIMARY-track copy of
-- transactional-migrations/0032_run_outcomes.sql. The tables are written on the operational
-- endpoint; this copy exists so a single-database environment (operational handle = core
-- handle) has them too, and stays empty wherever the operational endpoint is split out.
-- Same DDL, no foreign keys (scalar tenant/project ids), expand-only. See 0032 for the rationale.

CREATE TABLE IF NOT EXISTS run_features (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL,
  project_id     BIGINT,
  run_id         VARCHAR(128) NOT NULL,
  repository     VARCHAR(512) NOT NULL,
  entry_point    VARCHAR(16) NOT NULL,
  mode           VARCHAR(16) NOT NULL,
  model_tier     VARCHAR(64),
  schema_version INTEGER NOT NULL,
  finalized_at   TIMESTAMPTZ NOT NULL,
  feature_values JSONB NOT NULL,
  digest         VARCHAR(64) NOT NULL,
  requester_id   VARCHAR(128),
  approver_id    VARCHAR(128),
  reviewer_id    VARCHAR(128),
  agent_id       VARCHAR(128),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_features_tenant_run_repo_key ON run_features (tenant_id, run_id, repository);

CREATE TABLE IF NOT EXISTS run_commit_attributions (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  run_id       VARCHAR(128) NOT NULL,
  repository   VARCHAR(512) NOT NULL,
  commit_sha   VARCHAR(64) NOT NULL,
  path         VARCHAR(1024) NOT NULL,
  branch       VARCHAR(255),
  added_lines  INTEGER,
  committed_at TIMESTAMPTZ NOT NULL,
  source       VARCHAR(16) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_commit_attributions_key ON run_commit_attributions (tenant_id, run_id, repository, commit_sha, path);
CREATE INDEX IF NOT EXISTS idx_run_commit_attributions_sha ON run_commit_attributions (tenant_id, commit_sha);
CREATE INDEX IF NOT EXISTS idx_run_commit_attributions_branch ON run_commit_attributions (tenant_id, repository, branch);

CREATE TABLE IF NOT EXISTS run_outcome_labels (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL,
  run_id           VARCHAR(128) NOT NULL,
  repository       VARCHAR(512) NOT NULL,
  kind             VARCHAR(32) NOT NULL,
  value            BOOLEAN,
  status           VARCHAR(16) NOT NULL,
  event_at         TIMESTAMPTZ,
  window_ends_at   TIMESTAMPTZ,
  evidence         JSONB NOT NULL DEFAULT '{}'::jsonb,
  labeller_version INTEGER NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_outcome_labels_key ON run_outcome_labels (tenant_id, run_id, repository, kind);
CREATE INDEX IF NOT EXISTS idx_run_outcome_labels_censoring ON run_outcome_labels (status, window_ends_at);

CREATE TABLE IF NOT EXISTS run_outcome_training_consent (
  tenant_id    INTEGER PRIMARY KEY,
  cross_tenant BOOLEAN NOT NULL,
  decided_by   VARCHAR(128),
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
