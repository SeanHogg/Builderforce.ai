-- 0429_canvas_domain_targets.sql
--
-- Canvas domain targets
--
-- GENERATED from src/infrastructure/database/schema/canvas.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 2 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS stock_media_assets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  provider VARCHAR(48) NOT NULL,
  provider_ref VARCHAR(160) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  title VARCHAR(300),
  preview_url TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  keywords JSONB,
  license_kind VARCHAR(32) NOT NULL DEFAULT 'royalty_free',
  attribution_required BOOLEAN NOT NULL DEFAULT false,
  attribution_text VARCHAR(500),
  license_expires_at TIMESTAMP,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_media_assets_provider ON stock_media_assets (provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_stock_media_assets_kind ON stock_media_assets (kind, license_kind);

CREATE TABLE IF NOT EXISTS studio_async_interviews (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  question_set_id UUID,
  subject_ref VARCHAR(64),
  subject_email VARCHAR(320),
  share_link_id UUID,
  think_seconds INTEGER NOT NULL DEFAULT 30,
  answer_seconds INTEGER NOT NULL DEFAULT 120,
  max_takes INTEGER NOT NULL DEFAULT 2,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  invited_at TIMESTAMP,
  started_at TIMESTAMP,
  submitted_at TIMESTAMP,
  expires_at TIMESTAMP,
  reviewer_ref VARCHAR(64),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_studio_async_interviews_status ON studio_async_interviews (tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_studio_async_interviews_subject ON studio_async_interviews (tenant_id, subject_ref);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE stock_media_assets DROP CONSTRAINT IF EXISTS fk_stock_media_assets_tenant;
ALTER TABLE stock_media_assets ADD CONSTRAINT fk_stock_media_assets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE studio_async_interviews DROP CONSTRAINT IF EXISTS fk_studio_async_interviews_tenant;
ALTER TABLE studio_async_interviews ADD CONSTRAINT fk_studio_async_interviews_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
