-- 1344 · Run deltas (PRD 41 §C14, WS11) — what an agent run changed, per repository, as the server keeps it.
--
-- EXPAND ONLY: three new tables, no edits to existing ones.
--
--   run_deltas            — one row per (tenant, run, repo key): the headline, blast radius, digest and the
--                           headline sentence MODEL. The full delta (evidence) is a blob in R2 keyed by digest.
--   run_delta_dimensions  — one row per delta × dimension (verdict + introduced/resolved/changed counts).
--                           Dimensions are registry data, so a new one is a row, never a migration.
--   run_delta_findings    — one row per finding, with its card-text embedding in the bge-m3 1024 space
--                           (1256's convention: model stamp, embedded_at, HNSW cosine index, partial
--                           "unembedded" index for the resumable keyset backfill). A write never waits for
--                           a vector; the backfill sweep fills it.
--
-- Written by the sync mirror importer for the `run-delta` local record, inside the push's transaction
-- (so on the primary endpoint). `project_id` is a plain id: cross-domain references are ids.
-- Retention: 2 years (sweptTablesBounded.ts), children cascade from run_deltas; the R2 evidence blob
-- expires on the same 730 days (infra/uploads/lifecycle.json).
-- No CREATE INDEX CONCURRENTLY: the runner wraps each file in one transaction and the tables are new.

CREATE TABLE IF NOT EXISTS run_deltas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    BIGINT,
  run_id        VARCHAR(128) NOT NULL,
  repo_key      VARCHAR(128) NOT NULL,
  repository    VARCHAR(512) NOT NULL,
  surface       VARCHAR(16) NOT NULL,
  mode          VARCHAR(16) NOT NULL,
  delta_version SMALLINT NOT NULL,
  digest        VARCHAR(64) NOT NULL,
  headline      VARCHAR(20) NOT NULL,
  blast_score   DOUBLE PRECISION NOT NULL,
  blast_band    VARCHAR(8) NOT NULL,
  summary       JSONB NOT NULL,
  blocking      JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_deltas_tenant_run_repo_key ON run_deltas (tenant_id, run_id, repo_key);
CREATE INDEX IF NOT EXISTS run_deltas_tenant_project_computed_idx ON run_deltas (tenant_id, project_id, computed_at, id);
CREATE INDEX IF NOT EXISTS run_deltas_created_at_idx ON run_deltas (created_at);

CREATE TABLE IF NOT EXISTS run_delta_dimensions (
  run_delta_id UUID NOT NULL REFERENCES run_deltas(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dimension_id VARCHAR(64) NOT NULL,
  verdict      VARCHAR(20) NOT NULL,
  introduced   INTEGER NOT NULL,
  resolved     INTEGER NOT NULL,
  changed      INTEGER NOT NULL,
  PRIMARY KEY (run_delta_id, dimension_id)
);
-- Every tenant-scoped read of the dimensions (and tenant erasure) filters on tenant_id.
CREATE INDEX IF NOT EXISTS run_delta_dimensions_tenant_idx ON run_delta_dimensions (tenant_id);

CREATE TABLE IF NOT EXISTS run_delta_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_delta_id    UUID NOT NULL REFERENCES run_deltas(id) ON DELETE CASCADE,
  identity_id     TEXT NOT NULL,
  -- sha256 hex of identity_id: the unique key. An identity id lists every member path, so it is
  -- unbounded and would overflow a btree key; its hash never does.
  identity_hash   VARCHAR(64) NOT NULL,
  anchor          VARCHAR(1024) NOT NULL,
  dimension_id    VARCHAR(64) NOT NULL,
  rule_id         VARCHAR(128) NOT NULL,
  rule_version    INTEGER NOT NULL,
  severity        VARCHAR(8) NOT NULL,
  lineage         VARCHAR(16) NOT NULL,
  confidence      VARCHAR(16) NOT NULL,
  card_text       TEXT NOT NULL,
  embedding       vector(1024),
  embedding_model VARCHAR(64),
  embedded_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS run_delta_findings_delta_identity_key ON run_delta_findings (run_delta_id, identity_hash);
CREATE INDEX IF NOT EXISTS run_delta_findings_tenant_anchor_idx ON run_delta_findings (tenant_id, anchor);
CREATE INDEX IF NOT EXISTS run_delta_findings_embedding_hnsw
  ON run_delta_findings USING hnsw (embedding vector_cosine_ops);
-- The 1024 backfill's keyset claim: "rows with no bge-m3 vector, by id".
CREATE INDEX IF NOT EXISTS run_delta_findings_unembedded_idx
  ON run_delta_findings (id) WHERE embedding IS NULL;

COMMENT ON COLUMN run_delta_findings.embedding IS 'bge-m3 (Workers AI, 1024-d) embedding of card_text. NULL = not embedded yet; the memory embedding backfill fills it.';
COMMENT ON COLUMN run_delta_findings.embedding_model IS 'Model that produced `embedding`. The ANN read filters on it.';

-- Retention-swept (2 years) and vacuumed: per-table autovacuum tuning (check:swept-tables).
ALTER TABLE IF EXISTS run_deltas SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS run_delta_dimensions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS run_delta_findings SET (autovacuum_vacuum_scale_factor = 0.05);
