-- Stakeholder alignment: map, diagnostic profile, conflicts, sign-off and escalation.
CREATE TABLE IF NOT EXISTS stakeholder_map_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  stakeholder_ref VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('required_approver','informed')),
  team_scope VARCHAR(120),
  priority TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stakeholder_map_project_ref UNIQUE (tenant_id, project_id, stakeholder_ref)
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_map_project ON stakeholder_map_entries(tenant_id, segment_id, project_id, active);

CREATE TABLE IF NOT EXISTS stakeholder_health_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stakeholder_health_project UNIQUE (tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS stakeholder_priority_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stakeholder_ref VARCHAR(64) NOT NULL,
  team_scope VARCHAR(120) NOT NULL,
  priority_key VARCHAR(160) NOT NULL,
  rationale TEXT,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_priority_window ON stakeholder_priority_submissions(tenant_id, project_id, team_scope, submitted_at);

CREATE TABLE IF NOT EXISTS stakeholder_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signature VARCHAR(255) NOT NULL,
  team_scope VARCHAR(120) NOT NULL,
  priority_keys JSONB NOT NULL,
  stakeholder_refs JSONB NOT NULL,
  summary TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  CONSTRAINT uq_stakeholder_conflict_signature UNIQUE (tenant_id, project_id, signature)
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_conflicts_project ON stakeholder_conflicts(tenant_id, project_id, status, detected_at);

CREATE TABLE IF NOT EXISTS stakeholder_alignment_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_ref VARCHAR(160) NOT NULL,
  summary TEXT NOT NULL,
  required_approver_refs JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'in_review' CHECK (status IN ('draft','submitted','in_review','approved','blocked','escalated','agreed')),
  due_at TIMESTAMP NOT NULL,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_reviews_project ON stakeholder_alignment_reviews(tenant_id, project_id, status, due_at);

CREATE TABLE IF NOT EXISTS stakeholder_alignment_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES stakeholder_alignment_reviews(id) ON DELETE CASCADE,
  stakeholder_ref VARCHAR(64) NOT NULL,
  response VARCHAR(32) NOT NULL CHECK (response IN ('approve','approve_with_comment','block')),
  comment TEXT,
  responded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stakeholder_response_reviewer UNIQUE (review_id, stakeholder_ref)
);

CREATE TABLE IF NOT EXISTS stakeholder_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES stakeholder_alignment_reviews(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  owner_ref VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','breached')),
  deadline_at TIMESTAMP NOT NULL,
  reminder_24h_at TIMESTAMP,
  reminder_4h_at TIMESTAMP,
  outcome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  CONSTRAINT uq_stakeholder_escalation_level UNIQUE (review_id, level)
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_escalations_due ON stakeholder_escalations(tenant_id, status, deadline_at);
