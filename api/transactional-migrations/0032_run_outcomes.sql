-- 0032 · Run outcomes (PRD 41 §D1, WS16): the training data every Part D model learns from.
-- These tables live on THIS (operational) track ("training data lives in the ops database");
-- the primary track carries the same DDL in migrations/1342_run_outcomes.sql so single-database
-- environments have them too. Expand-only. No foreign keys: tenant and project are scalar ids
-- (README), exactly like run_model_outcomes; tenant erasure is application/shared/siblingCascade.
--
-- run_features              one FROZEN vector per (tenant, run, repository): inserted once, never updated.
--                           requester_id/approver_id/reviewer_id/agent_id are person ids, D14-restricted:
--                           the cross-tenant aggregate never selects them.
-- run_commit_attributions   one row per (run, repository, commit, path): the commits holding the run's content.
-- run_outcome_labels        one row per (run, repository, kind); censored until its window ends.
-- run_outcome_training_consent  a tenant's explicit cross-tenant training decision (§12.8); no row = plan default.

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

-- Retention-swept (sweptTablesBounded.ts, 730 days): per-table autovacuum tuning in the
-- style of 0009 — append-mostly training rows, so no fillfactor reservation except on
-- run_outcome_labels, whose censored rows are UPDATEd as their window closes (HOT updates).
ALTER TABLE run_features            SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                         autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE run_commit_attributions SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                         autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE run_outcome_labels      SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                         autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000,
                                         fillfactor = 90);

-- brain_chat_steps (0023) has been retention-swept on this endpoint (sweptTablesBounded.ts, 30 days)
-- without its tuning: check-swept-tables did not parse the OPERATIONAL entries, so the hole was
-- invisible. The guard reads them now; the tuning is stated here, in the same 0009 style.
ALTER TABLE IF EXISTS brain_chat_steps SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                            autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
