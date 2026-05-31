-- Migration: Segment tier — the isolation level BETWEEN tenant and entity.
--
-- BuilderForce is multi-tenant (tenant = a consumer of the platform, e.g.
-- BurnRateOS). Some tenants are THEMSELVES multi-tenant: they serve their own
-- end-clients. A SEGMENT carries that end-client's (account, company) so no
-- client's data bleeds. Isolation hierarchy: Tenant -> Segment -> Entity.
--
-- Design invariant (see README "Segment tier"): EVERY tenant always has >= 1
-- segment. A single-tenant customer (isolation_mode='single') gets ONE
-- auto-created default segment (is_default=true) it never sees, so segment_id
-- can be NOT NULL on every business entity and single-mode vs segmented-mode
-- share ONE query path — no nullable escape hatch, no `if (segmented)` forks.
--
-- This migration is the dependency root. It is reversible and changes NO
-- behavior until a later migration adds segment_id columns + a resolveSegment
-- chokepoint reads them. The work_items spine (unified PM/Agile/agent backlog)
-- and segment_id propagation land in following migrations.

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE segment_status AS ENUM ('active', 'suspended', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- How a tenant authenticates its users:
--   direct   → BuilderForce is the IdP (local users / OAuth / magic-link). Default.
--   embedded → an external host is the IdP (OIDC); identity arrives as claims.
DO $$
BEGIN
  CREATE TYPE tenant_kind AS ENUM ('embedded', 'direct');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Whether the tenant sub-divides into segments:
--   single    → pinned to one default segment (the common case). Default.
--   segmented → the tenant is itself multi-tenant; one segment per end-client.
DO $$
BEGIN
  CREATE TYPE tenant_isolation_mode AS ENUM ('single', 'segmented');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Tenant identity / mode columns (fold spec's Tenant model into existing) ──

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind           tenant_kind           NOT NULL DEFAULT 'direct';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS idp_issuer     VARCHAR(500);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS isolation_mode tenant_isolation_mode NOT NULL DEFAULT 'single';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings       TEXT;

-- ── Segments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS segments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Host coordinates of a federated end-client. NULL on the tenant's default segment.
  external_account_id VARCHAR(255),
  external_company_id VARCHAR(255),
  display_name        VARCHAR(255) NOT NULL,
  slug                VARCHAR(255) NOT NULL,
  plan                VARCHAR(50)  NOT NULL DEFAULT 'free',
  status              segment_status NOT NULL DEFAULT 'active',
  settings            TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  provisioned_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at      TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One segment per (tenant, account, company). Real segments carry non-null
-- coordinates; the default segment carries (NULL, NULL) and is kept unique by
-- the partial index below (NULLs are distinct, so this index never blocks it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_segments_tenant_account_company
  ON segments (tenant_id, external_account_id, external_company_id);

-- Exactly one default segment per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_segments_one_default_per_tenant
  ON segments (tenant_id) WHERE is_default;

-- Slugs are unique within a tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_segments_tenant_slug
  ON segments (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_segments_tenant_status
  ON segments (tenant_id, status);

-- ── Backfill: every existing tenant gets its default segment ─────────────────

INSERT INTO segments (tenant_id, display_name, slug, plan, status, is_default)
SELECT t.id, t.name, 'default', t.plan::text, 'active'::segment_status, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM segments s WHERE s.tenant_id = t.id AND s.is_default
);
