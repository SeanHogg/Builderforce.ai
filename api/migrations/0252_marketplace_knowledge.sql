-- Migration 0252: sell authored knowledge in the marketplace.
--
-- Knowledge documents (SOPs / processes / docs / canvases) had no path to the
-- marketplace — only skills (separate marketplace auth) and personas were
-- listable. This mirrors marketplace_personas (0203): tenant-scoped rows with a
-- public visibility tier and install/like counters, but the listing carries a
-- CONTENT SNAPSHOT so installing copies the knowledge into the buyer's tenant as
-- a fresh document (the source can change/delete without affecting buyers).
--
--   * tenant_id / created_by   — seller + author for "my listings" management.
--   * source_document_id        — the doc it was published from (SET NULL if the
--                                 doc is later deleted); one listing per source doc.
--   * doc_type / content / tags — snapshot used to recreate the doc on install.
--   * price_cents               — sale price (0 = free). Charging/checkout is a
--                                 separate Stripe integration (see roadmap); install
--                                 currently grants a copy.
--   * visibility                — 'private' | 'tenant' | 'public' (public = browsable).
--   * install_count / like_count — marketplace social proof.

CREATE TABLE IF NOT EXISTS marketplace_knowledge (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by         VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  title              VARCHAR(255) NOT NULL,
  summary            TEXT,
  doc_type           VARCHAR(16) NOT NULL DEFAULT 'doc',
  content            TEXT NOT NULL DEFAULT '',
  category           VARCHAR(100),
  tags               TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  price_cents        INTEGER NOT NULL DEFAULT 0,
  visibility         VARCHAR(16) NOT NULL DEFAULT 'public',
  author_name        VARCHAR(255),
  install_count      INTEGER NOT NULL DEFAULT 0,
  like_count         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One listing per source document (re-listing updates the snapshot in place).
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_knowledge_source
  ON marketplace_knowledge(source_document_id) WHERE source_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_knowledge_tenant ON marketplace_knowledge(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_knowledge_public ON marketplace_knowledge(visibility) WHERE visibility = 'public';
