-- 1302 · Pack sync hardening (PRD 41 A11 rules 4a-4b; security and storage re-review). Additive; 1300 and 1301 are NOT edited.
--
--   knowledge_sync_leaves.leaf_key_hash  sha256 of leaf_key (bytea). The key becomes the PK in place of the long text key: a
--                                        relation leaf key holds two refs (up to 4 KB each), past what a btree entry takes
--                                        (about 2.7 KB), so an index over the text itself could fail an insert.
--                                        `leaf_key` stays as a plain column, never indexed.
--   knowledge_sync_leaves.bucket         the manifest bucket (0..4095) of the key, computed by the codec's `bucketOf`, so a
--                                        pack reads only the buckets it touched. Rows written before this have NULL and are
--                                        filled lazily by the server (`ensureBuckets`), once per root.
--   knowledge_sync_buckets               (tenant, project, root, bucket) -> digest. The root digest is built from these
--                                        stored bucket digests; a pack recomputes only the buckets it touched.
--
-- 1301 has not run anywhere when this lands, but it is written as if it had: add, backfill, then swap the primary key, each
-- step guarded so the file is idempotent and re-runnable. The text-key index of the "named by other roots" lookup is
-- replaced by the same lookup over the hash.
SET LOCAL lock_timeout = '3s';

ALTER TABLE knowledge_sync_leaves ADD COLUMN IF NOT EXISTS leaf_key_hash bytea;
ALTER TABLE knowledge_sync_leaves ADD COLUMN IF NOT EXISTS bucket smallint;

UPDATE knowledge_sync_leaves SET leaf_key_hash = sha256(convert_to(leaf_key, 'UTF8')) WHERE leaf_key_hash IS NULL;

ALTER TABLE knowledge_sync_leaves ALTER COLUMN leaf_key_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'knowledge_sync_leaves'::regclass AND i.indisprimary AND a.attname = 'leaf_key_hash'
  ) THEN
    ALTER TABLE knowledge_sync_leaves DROP CONSTRAINT IF EXISTS pk_knowledge_sync_leaves;
    ALTER TABLE knowledge_sync_leaves ADD CONSTRAINT pk_knowledge_sync_leaves PRIMARY KEY (tenant_id, project_id, root_id, leaf_key_hash);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_knowledge_sync_leaves_key;
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_leaves_keyhash ON knowledge_sync_leaves (tenant_id, project_id, leaf_key_hash);
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_leaves_bucket ON knowledge_sync_leaves (tenant_id, project_id, root_id, bucket);

CREATE TABLE IF NOT EXISTS knowledge_sync_buckets (
  tenant_id  integer      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id    varchar(512) NOT NULL,
  bucket     smallint     NOT NULL,
  digest     bytea        NOT NULL,
  CONSTRAINT pk_knowledge_sync_buckets PRIMARY KEY (tenant_id, project_id, root_id, bucket)
);
