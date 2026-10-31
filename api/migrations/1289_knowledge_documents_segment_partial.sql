-- 1289 · Make the NULL-able segment index on knowledge_documents partial.
--
-- Third of three files split from the operator-approved (2026-10-31) index clean-up (see 1287). 1 index: idx_knowledge_documents_segment
-- is dropped and re-created under the same name WHERE segment_id IS NOT NULL. Its own file because the DROP then CREATE
-- (a SHARE lock on the table, blocking writes) is a different lock profile from the pure drops.
--
-- LOCKS. A plain DROP INDEX takes ACCESS EXCLUSIVE on its table until COMMIT, and scripts/migrate.mjs runs each file as ONE
-- transaction (sql.transaction over the Neon HTTP transport: BEGIN, every statement, the ledger INSERT, COMMIT). `SET LOCAL
-- lock_timeout` is the first statement of that transaction, so it bounds every lock wait in this file to 3s and reverts at COMMIT.
-- If a lock cannot be had in time the statement errors, the whole file rolls back (nothing half-applied, no ledger row), the
-- deploy fails cleanly BEFORE the Worker deploys, and the fix is to re-run the deploy.
--
-- WHY IT IS SAFE
--   C. A query filtering segment_id = $1 still uses a partial index WHERE segment_id IS NOT NULL (the equality implies the
--      predicate). knowledge_documents.segment_id is a nullable column with no NOT NULL and no default-fill trigger
--      (NULL = workspace-wide), so the partial index leaves the NULL rows out. Every other single-column segment_id index
--      sits on a column that is NOT NULL (0056) or is filled by the set_default_segment_id() trigger (0057: soc_controls,
--      soc_evidence, security_vendors, security_incidents — no NULL can be inserted), where a partial index gains nothing,
--      or was ambiguous in replay (0056 ran its guarded block before the table existed), and is left alone.
--
-- REVERSIBLE: re-create the index without the WHERE.

SET LOCAL lock_timeout = '3s';

-- ── C. Partial segment index ─────────────────────────────────────────────────────────────────────────────────
-- Drop THEN create under the same name: CREATE INDEX IF NOT EXISTS alone would be a no-op against the existing full index.
DROP INDEX IF EXISTS idx_knowledge_documents_segment;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_segment ON knowledge_documents (segment_id) WHERE segment_id IS NOT NULL;
