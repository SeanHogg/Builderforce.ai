-- Legal document version history.
--
-- `legal_documents` keeps only the current active row per docType plus retired
-- rows from prior *publishes*; an *amend* overwrites the active row in place, so
-- the pre-amend text was previously lost. This table snapshots every write
-- (publish AND amend) so `GET /admin/legal/history` can show the full audit
-- trail. It mirrors `knowledge_document_versions`.
CREATE TABLE IF NOT EXISTS legal_document_versions (
  id            SERIAL PRIMARY KEY,
  document_type legal_document_type NOT NULL,
  version       VARCHAR(50) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL,
  change_kind   VARCHAR(16) NOT NULL DEFAULT 'publish', -- 'publish' | 'amend'
  changed_by    VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_document_versions_type_idx
  ON legal_document_versions (document_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Content backfill (write-normalization was added on the WRITE path only, so
-- historical rows may still carry a wrapping ```markdown fence). Strip a leading
-- and trailing fence in place — the SQL equivalent of stripMarkdownFence().
-- ---------------------------------------------------------------------------
UPDATE legal_documents
SET content = regexp_replace(
      regexp_replace(content, '^\s*```(?:markdown|md)?[ \t]*\r?\n', ''),
      '\r?\n?```[ \t]*$', ''),
    updated_at = now()
WHERE content ~ '^\s*```';

-- Retire stale pre-rebrand placeholder brand text left in the seeded legal rows
-- (migration 0012 seeded "CoderClawLink"). The product is Builderforce.ai.
UPDATE legal_documents
SET content = replace(content, 'CoderClawLink', 'Builderforce.ai'),
    updated_at = now()
WHERE content LIKE '%CoderClawLink%';

-- Seed the history table with the current state of every existing legal row so
-- history is never empty for docs that predate this table.
INSERT INTO legal_document_versions (document_type, version, title, content, change_kind, changed_by, created_at)
SELECT document_type, version, title, content, 'publish', published_by, published_at
FROM legal_documents;
