-- 1300 · Pack sync storage (PRD 41 A11 rule 4a): bounded writes per pack, not per file.
--
-- A first sync of a 20,000-file root used to write one R2 object per source and one per content hash
-- (about 40,000 object writes in one Worker request, past the subrequest cap). Pack sync now writes
-- ONE content-addressed bundle object per pack part and records where each body lives, and records the
-- root's sources as rows, all in the same Postgres transaction as the facts and relations.
--
--   knowledge_extracted_index  (tenant, project, hash) -> bundle_key, byte_offset, byte_length
--                              A body is read with a ranged GET of its bundle; "does the project hold this
--                              hash" is one query. Hashes written before this have no row and are read from
--                              their legacy per-hash object (`knowledge/{t}/{p}/extracted/{hash}.json`).
--   knowledge_sources          (tenant, project, root, source_id) -> path, hash
--                              The current sources of a root. Legacy per-source R2 objects are still read.
--
-- Expand only: two new tables, nothing read or written by the old Worker, no backfill. Idempotent /
-- re-runnable; reversible by DROP TABLE. Nothing is contracted in this push.
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS knowledge_extracted_index (
  tenant_id   integer      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hash        varchar(160) NOT NULL,
  bundle_key  text         NOT NULL,
  byte_offset integer      NOT NULL,
  byte_length integer      NOT NULL,
  source_refs text[]       NOT NULL DEFAULT '{}',
  created_at  timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT pk_knowledge_extracted_index PRIMARY KEY (tenant_id, project_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_extracted_index_bundle ON knowledge_extracted_index (bundle_key);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  tenant_id  integer      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id    varchar(512) NOT NULL,
  source_id  text         NOT NULL,
  path       text         NOT NULL,
  hash       varchar(160) NOT NULL,
  updated_at timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT pk_knowledge_sources PRIMARY KEY (tenant_id, project_id, root_id, source_id)
);
