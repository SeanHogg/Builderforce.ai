-- 1301 · Pack sync's manifest and generations in Postgres (PRD 41 A11 rule 4b).
--
-- 1300 recorded where extracted bodies live. This adds what the sync protocol compares:
--
--   knowledge_sync_leaves  (tenant, project, root, leaf_key) -> digest
--                          The leaf digests of the rows THIS ROOT synced, exactly as the client computed them
--                          (`f:<source id>`, `a:<fact key>`, `r:<from>␀<to>␀<kind>`). The server's manifest tree is
--                          built from this table only: never from `project_facts`, which is shared by every root of
--                          the project, truncated for display, and normalised by the fact writer. Tombstones are
--                          limited to a root's own leaves.
--   knowledge_sync_roots   (tenant, project, root) -> generation, digest
--                          Replaces the `sync.json` object. A pack advances it with a conditional UPDATE inside its
--                          transaction, so two concurrent packs have exactly one winner. A `sync.json` found on first
--                          read is copied into a row and deleted.
--
-- Also an index on knowledge_sources(hash) so the age sweep can ask "does any source still name this hash".
--
-- Expand only: two new tables and one index; nothing the old Worker reads or writes. Idempotent / re-runnable;
-- reversible by DROP. 1300 is not edited.
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS knowledge_sync_leaves (
  tenant_id  integer      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id    varchar(512) NOT NULL,
  leaf_key   text         NOT NULL,
  digest     varchar(160) NOT NULL,
  CONSTRAINT pk_knowledge_sync_leaves PRIMARY KEY (tenant_id, project_id, root_id, leaf_key)
);

-- Which roots name a fact or relation key: a tombstone deletes the row only when no OTHER root's leaves name it.
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_leaves_key ON knowledge_sync_leaves (tenant_id, project_id, leaf_key);

CREATE TABLE IF NOT EXISTS knowledge_sync_roots (
  tenant_id  integer      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id    varchar(512) NOT NULL,
  generation integer      NOT NULL DEFAULT 0,
  digest     varchar(64)  NOT NULL DEFAULT '',
  updated_at timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT pk_knowledge_sync_roots PRIMARY KEY (tenant_id, project_id, root_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_hash ON knowledge_sources (tenant_id, project_id, hash);
