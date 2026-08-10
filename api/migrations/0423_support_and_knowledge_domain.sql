-- 0423_support_and_knowledge_domain.sql
--
-- Support and knowledge domain
--
-- GENERATED from src/infrastructure/database/schema/support.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 3 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS support_articles (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  slug VARCHAR(200) NOT NULL,
  title VARCHAR(300) NOT NULL,
  summary TEXT,
  body TEXT,
  kind VARCHAR(24) NOT NULL DEFAULT 'article',
  category VARCHAR(96),
  tags JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  visibility VARCHAR(16) NOT NULL DEFAULT 'tenant',
  owner_ref VARCHAR(64),
  review_due_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  unhelpful_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_articles_slug ON support_articles (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_support_articles_status ON support_articles (tenant_id, status, visibility, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_articles_review ON support_articles (tenant_id, review_due_at);

CREATE TABLE IF NOT EXISTS customer_engagement_feedback_widgets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'csat',
  question_set_id UUID,
  placement JSONB,
  audience JSONB,
  theme JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cooldown_days INTEGER NOT NULL DEFAULT 30,
  response_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_engagement_feedback_widgets_key ON customer_engagement_feedback_widgets (tenant_id, key);
CREATE INDEX IF NOT EXISTS idx_customer_engagement_feedback_widgets_enabled ON customer_engagement_feedback_widgets (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS feedback_sentiments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  source_ref VARCHAR(64) NOT NULL,
  source_table VARCHAR(48) NOT NULL,
  widget_id INTEGER REFERENCES customer_engagement_feedback_widgets(id) ON DELETE SET NULL,
  label VARCHAR(16) NOT NULL,
  score NUMERIC(4, 2),
  confidence NUMERIC(4, 2),
  themes JSONB,
  excerpt TEXT,
  model VARCHAR(96),
  classified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_sentiments_source ON feedback_sentiments (tenant_id, source_table, source_ref, model);
CREATE INDEX IF NOT EXISTS idx_feedback_sentiments_label ON feedback_sentiments (tenant_id, label, classified_at);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE support_articles DROP CONSTRAINT IF EXISTS fk_support_articles_tenant;
ALTER TABLE support_articles ADD CONSTRAINT fk_support_articles_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE customer_engagement_feedback_widgets DROP CONSTRAINT IF EXISTS fk_customer_engagement_feedback_widgets_tenant;
ALTER TABLE customer_engagement_feedback_widgets ADD CONSTRAINT fk_customer_engagement_feedback_widgets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE feedback_sentiments DROP CONSTRAINT IF EXISTS fk_feedback_sentiments_tenant;
ALTER TABLE feedback_sentiments ADD CONSTRAINT fk_feedback_sentiments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
