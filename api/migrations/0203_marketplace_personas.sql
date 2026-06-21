-- Migration 0203: server-backed personas marketplace.
--
-- Until now personas were hardcoded builtins (platform_personas, admin-managed)
-- plus per-tenant localStorage in the frontend — there was no way for a tenant to
-- PUBLISH a persona others could browse and install. This mirrors the prompt
-- library (prompt_library_entries): tenant-scoped rows with a public visibility
-- tier, a globally-unique public slug, and usage/like counters.
--
--   * tenant_id / created_by   — owner + author for "my personas" management.
--   * slug                      — globally unique among PUBLIC rows (partial index),
--                                 so /api/personas/:slug resolves one published row.
--   * persona (jsonb)           — the persona body the editor uses:
--                                 { voice, perspective, decisionStyle, outputPrefix,
--                                   capabilities[], systemDirectives? }.
--   * visibility                — 'private' | 'tenant' | 'public'.
--   * install_count / like_count — marketplace social proof.

CREATE TABLE IF NOT EXISTS marketplace_personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by    VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  description   TEXT,
  category      VARCHAR(100),
  tags          TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  persona       JSONB NOT NULL DEFAULT '{}'::jsonb,    -- voice/perspective/decisionStyle/outputPrefix/capabilities/systemDirectives
  visibility    VARCHAR(16) NOT NULL DEFAULT 'private',
  author_name   VARCHAR(255),
  install_count INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public slugs are globally unique; private/tenant rows are unconstrained on slug.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_personas_public_slug
  ON marketplace_personas(slug) WHERE visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_marketplace_personas_tenant ON marketplace_personas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_personas_public
  ON marketplace_personas(visibility, install_count DESC) WHERE visibility = 'public';
