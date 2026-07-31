-- 0300_facts.sql
-- FACTS library: a structured, queryable tenant knowledge store of
-- (subject, predicate, object) triples with provenance. Powers /api/facts and
-- the /facts page; recallable by agent tooling.
--
--   project_id NULL  → a tenant-global fact (applies everywhere)
--   project_id set   → a fact scoped to one project
--   confidence       → 0..1 provenance weight (NULL = unspecified)
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  subject     VARCHAR(255) NOT NULL,
  predicate   VARCHAR(255) NOT NULL,
  object      TEXT NOT NULL,
  source      VARCHAR(255),
  confidence  REAL,
  created_by  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant list ordering (newest-updated first).
CREATE INDEX IF NOT EXISTS idx_facts_tenant_updated
  ON facts(tenant_id, updated_at DESC);

-- Subject / predicate filters + the distinct-value dropdowns.
CREATE INDEX IF NOT EXISTS idx_facts_tenant_subject
  ON facts(tenant_id, subject);
CREATE INDEX IF NOT EXISTS idx_facts_tenant_predicate
  ON facts(tenant_id, predicate);

-- Project-scoped recall.
CREATE INDEX IF NOT EXISTS idx_facts_tenant_project
  ON facts(tenant_id, project_id);
