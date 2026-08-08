-- Stakeholder Alignment Diagnostic - Schema for stakeholder mapping and alignment.
-- Provides stakeholder data management, relationship tracking, and alignment diagnostics.
--
-- Note: Migration 0340 was already taken by llm_usage_byo_provider.sql,
-- so using 0396 as the next available migration number.

-- Stakeholder map: core stakeholder entity
CREATE TABLE IF NOT EXISTS stakeholder_maps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  role            VARCHAR(100),  -- e.g., 'Project Manager', 'Team Lead', 'Executive', 'Stakeholder'
  organization    VARCHAR(255),
  department      VARCHAR(255),
  project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email, project_id)
);

CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_tenant ON stakeholder_maps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_project ON stakeholder_maps(project_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_maps_segment ON stakeholder_maps(segment_id);

-- Stakeholder relationships: tracks relationships between stakeholders
CREATE TABLE IF NOT EXISTS stakeholder_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  source_stakeholder_id UUID NOT NULL REFERENCES stakeholder_maps(id) ON DELETE CASCADE,
  target_stakeholder_id UUID NOT NULL REFERENCES stakeholder_maps(id) ON DELETE CASCADE,
  relationship_type   VARCHAR(50) NOT NULL,  -- e.g., 'reports_to', 'collaborates_with', 'depends_on', 'supports'
  strength            VARCHAR(20) DEFAULT 'medium',  -- strong, medium, weak
  description         TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, source_stakeholder_id, target_stakeholder_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_source ON stakeholder_relationships(source_stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_target ON stakeholder_relationships(target_stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_type ON stakeholder_relationships(relationship_type);

-- Stakeholder alignment snapshots: point-in-time alignment assessments
CREATE TABLE IF NOT EXISTS stakeholder_alignment_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  alignment_score     INTEGER,  -- 0-100
  communication_score INTEGER,  -- 0-100
  resource_score      INTEGER,  -- 0-100
  findings            JSONB DEFAULT '[]'::jsonb,
  recommendations     JSONB DEFAULT '[]'::jsonb,
  created_by          VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_stakeholder_alignment_snapshots_project ON stakeholder_alignment_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_alignment_snapshots_date ON stakeholder_alignment_snapshots(snapshot_date DESC);
