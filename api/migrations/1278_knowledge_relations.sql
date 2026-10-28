-- 1278 · The knowledge graph's stored half (PRD 38 §4.2): relations between facts and
-- sources, and one row per reviewed root.
--
-- A fact on its own is a memory; facts connected by edges are knowledge. Judgement nodes
-- (claims, merged entities, summaries) stay `project_facts` rows in the key namespaces
-- `ent:<pack>:<name>` / `claim:<hash>`, anchored by the existing `file_anchors`
-- (`{path, line?, contentHash?}`, 1242/1248 — `contentHash` is already carried, so no
-- anchor change is needed here). There is NO entity table: a new kind is a key namespace.
--
--   project_fact_relations  one edge between two NodeRefs (`src:` / `ent:` / `fact:`).
--                           `origin` is model | human | agent — `extracted` edges are
--                           perception, recomputed from sources, and NEVER stored.
--                           `source_hash` is the content hash a model edge was judged from;
--                           `stale_at` is set when that source changes.
--   knowledge_scopes        one row per reviewed root: its packs and the last review digest.
--                           Scope membership is derived (anchor path / ref prefix), not stored.
--   project_facts.created_by  who asserted the fact, so `DELETE …/facts/:key` can admit
--                           its author (PRD 38 §8.3). NULL for every existing row and for
--                           facts an agent or host wrote.
--   project_facts.origin    model | human | agent — the knowledge-graph origin a fact was
--                           asserted with. A `model` fact goes stale when its anchored
--                           source changes. NULL on existing rows (read as `agent`, or
--                           `human` when a `created_by` is recorded).
--
-- Single writer: `application/knowledge/writeKnowledge.ts`.
--
-- `created_by` is varchar(36), not the PRD sketch's integer: `users.id` is varchar(36).
--
-- Expand only (push 1 of expand/contract): two new tables and two nullable columns, no
-- backfill, no drop. Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS project_fact_relations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_ref    varchar(512) NOT NULL,
  to_ref      varchar(512) NOT NULL,
  kind        varchar(32)  NOT NULL,
  weight      real NOT NULL DEFAULT 1,
  origin      varchar(8)   NOT NULL CHECK (origin IN ('model','human','agent')),
  confidence  real,
  source_hash varchar(64),
  stale_at    timestamp,
  created_by  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_fact_relation UNIQUE (tenant_id, project_id, from_ref, to_ref, kind)
);
CREATE INDEX IF NOT EXISTS idx_fact_relations_from ON project_fact_relations (tenant_id, project_id, from_ref);
CREATE INDEX IF NOT EXISTS idx_fact_relations_to   ON project_fact_relations (tenant_id, project_id, to_ref);

CREATE TABLE IF NOT EXISTS knowledge_scopes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id       integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id          varchar(512) NOT NULL,
  title            varchar(255),
  packs            varchar(64)[] NOT NULL,
  last_digest      varchar(64),
  last_reviewed_at timestamp,
  CONSTRAINT uq_knowledge_scope UNIQUE (tenant_id, project_id, root_id)
);

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin varchar(8) CHECK (origin IN ('model','human','agent'));
