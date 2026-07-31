-- Integration Audit tables for tracking integration health and data completeness
-- Migration 0334

-- Enum for integration status
CREATE TYPE integration_audit_status AS ENUM ('CONNECTED', 'PARTIAL', 'MISSING');

-- Enum for integration type
CREATE TYPE integration_audit_type AS ENUM (
  'source-control',   -- GitHub, GitLab, Bitbucket
  'issue-tracker',    -- Jira, Linear
  'communication',   -- Slack, Microsoft Teams
  'cicd',            -- GitHub Actions, Jenkins, CircleCI
  'monitoring',      -- Datadog, PagerDuty
  'calendar'         -- Google Calendar, Outlook, Asana
);

-- Enum for gap severity
CREATE TYPE gap_severity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- Enum for gap category
CREATE TYPE gap_category AS ENUM (
  'WEBHOOK', 
  'STALE_DATA', 
  'DATA_COMPLETENESS', 
  'CONFIGURATION', 
  'MISCONFIGURATION'
);

-- Integration connection table
CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  type integration_audit_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(100), -- e.g., 'github', 'jira', 'slack'
  status integration_audit_status DEFAULT 'MISSING',
  configuration JSONB DEFAULT '{}',
  credentials_id UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  last_sync TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integration_connections_tenant ON integration_connections(tenant_id);
CREATE INDEX idx_integration_connections_segment ON integration_connections(segment_id);
CREATE INDEX idx_integration_connections_type ON integration_connections(type);
CREATE UNIQUE INDEX idx_integration_connections_unique ON integration_connections(tenant_id, segment_id, type, provider);

-- Integration completeness score table
CREATE TABLE integration_completeness_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  total_weighted_score REAL DEFAULT 0,
  max_possible_score REAL DEFAULT 100,
  breakdown JSONB DEFAULT '{}',
  last_calculated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  calculated_by VARCHAR(50) DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tenant_id, segment_id, integration_id)
);

CREATE INDEX idx_completeness_scores_integration ON integration_completeness_scores(integration_id);
CREATE INDEX idx_completeness_scores_tenant ON integration_completeness_scores(tenant_id);

-- Integration gaps table
CREATE TABLE integration_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  severity gap_severity NOT NULL,
  category gap_category NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integration_gaps_integration ON integration_gaps(integration_id);
CREATE INDEX idx_integration_gaps_tenant ON integration_gaps(tenant_id);
CREATE INDEX idx_integration_gaps_unresolved ON integration_gaps(integration_id, resolved_at) WHERE resolved_at IS NULL;

-- Service tier weights table (for scoring)
CREATE TABLE service_tier_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  source_control_weight REAL DEFAULT 0.1,
  issue_tracker_weight REAL DEFAULT 0.15,
  communication_weight REAL DEFAULT 0.05,
  cicd_weight REAL DEFAULT 0.2,
  monitoring_weight REAL DEFAULT 0.2,
  calendar_weight REAL DEFAULT 0.05,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_service_tier_weights_tenant ON service_tier_weights(tenant_id);
