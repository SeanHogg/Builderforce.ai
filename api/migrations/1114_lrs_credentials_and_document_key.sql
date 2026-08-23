-- 1114 · The LRS's two remaining shapes: its credential lookup, and the exact
--        address of a State / Activity Profile / Agent Profile document.
--
-- 1112 established that an xAPI statement is an `activity_log` row and that an
-- LRS Basic key is a `credentials` row under a `connections` row. Building those
-- two surfaces turned up two things the existing DDL could not express.
--
-- ── 1 · RESOLVING A TENANT FROM A CREDENTIAL ────────────────────────────────
-- An inbound xAPI request carries exactly one thing: `Authorization: Basic`. It
-- does not carry a tenant, because the authoring tool that sends it has never
-- heard of one — resolving the workspace IS the authentication. So the lookup is
-- `(vendor, external_account)` with no tenant predicate, and `connections` has no
-- index that answers it: `uq_connections_account` leads with `tenant_id`, and
-- `idx_connections_tenant` does too.
--
-- Without this, every statement POST on the deployment sequentially scans the
-- whole connection table. Partial, because `lrs` is a handful of rows beside
-- every Google, Slack and Stripe grant on the platform.
CREATE INDEX IF NOT EXISTS idx_connections_lrs_key
  ON connections (external_account)
  WHERE vendor = 'lrs';

-- ── 2 · A DOCUMENT'S ADDRESS ────────────────────────────────────────────────
-- `uq_lrs_documents_key` was (tenant, scope, activity_id, agent_key, document_id)
-- over two NULLABLE columns, and in Postgres two NULLs are DISTINCT in a unique
-- index. So the constraint that exists to make a PUT idempotent did not: an
-- Activity Profile (no agent) or an Agent Profile (no activity) could be written
-- twice and read back ambiguously, which is the one thing the xAPI document
-- resources must not do.
--
-- The fix is to say "absent" with a value rather than with NULL. The table has no
-- application layer yet and therefore no rows to migrate, but the UPDATEs are
-- written anyway so the statement is safe on any environment that seeded it.
UPDATE lrs_documents SET activity_id   = '' WHERE activity_id   IS NULL;
UPDATE lrs_documents SET agent_key     = '' WHERE agent_key     IS NULL;
UPDATE lrs_documents SET registration  = '' WHERE registration  IS NULL;

ALTER TABLE lrs_documents ALTER COLUMN activity_id  SET DEFAULT '';
ALTER TABLE lrs_documents ALTER COLUMN agent_key    SET DEFAULT '';
ALTER TABLE lrs_documents ALTER COLUMN registration SET DEFAULT '';
ALTER TABLE lrs_documents ALTER COLUMN activity_id  SET NOT NULL;
ALTER TABLE lrs_documents ALTER COLUMN agent_key    SET NOT NULL;
ALTER TABLE lrs_documents ALTER COLUMN registration SET NOT NULL;

-- `registration` joins the key because the specification says it does: a State
-- document is addressed by activity + agent + registration + stateId, and two
-- learners' two attempts at the same activity are two documents. Leaving it out
-- made the second attempt overwrite the first.
DROP INDEX IF EXISTS uq_lrs_documents_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lrs_documents_key
  ON lrs_documents (tenant_id, scope, activity_id, agent_key, registration, document_id);

-- The listing every document resource offers ("which state ids exist for this
-- activity and agent") and the `since` filter the specification defines on it.
CREATE INDEX IF NOT EXISTS idx_lrs_documents_scope
  ON lrs_documents (tenant_id, scope, activity_id, agent_key, updated_at);
