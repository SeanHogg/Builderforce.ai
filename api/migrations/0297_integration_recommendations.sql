-- Migration 0297: Integration Recommendations & Tracking
-- Surfacing actionable third-party integrations users haven't installed yet.
-- -------------------------------------------------------------------------
-- 1. tracks recommendations across surfaces and user actions
-- 2. persists dismissal history with 30-day debouncing
-- 3. stores admin pin/suppression rules per workspace
-- 4. hooks into integration install flow for attribution

-- -------------------------------------------------------------------------
-- 1. Recommendation events table
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_events (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id      INTEGER NOT NULL REFERENCES projects(tenant_id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id    INTEGER NOT NULL REFERENCES integration_credentials(id) ON DELETE CASCADE,
  surface           TEXT    NOT NULL,  -- 'marketplace', 'onboarding', 'in_context'
  event_type        TEXT    NOT NULL,  -- 'impression', 'click', 'dismissed', 'installed'
  reason            TEXT,              -- dismiss reason (optional)
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_recommendation_events_tenant ON integration_recommendation_events(tenant_id);
CREATE INDEX idx_recommendation_events_workspace ON integration_recommendation_events(workspace_id);
CREATE INDEX idx_recommendation_events_user ON integration_recommendation_events(user_id);
CREATE INDEX idx_recommendation_events_integration ON integration_recommendation_events(integration_id);
CREATE INDEX idx_recommendation_events_surface ON integration_recommendation_events(surface);
CREATE INDEX idx_recommendation_events_type ON integration_recommendation_events(event_type);
CREATE INDEX idx_recommendation_events_created ON integration_recommendation_events(created_at DESC);

-- -------------------------------------------------------------------------
-- 2. Dismissal history table (with 30-day anti-spam debounce)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_dismissals (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id      INTEGER NOT NULL REFERENCES projects(tenant_id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id    INTEGER NOT NULL REFERENCES integration_credentials(id) ON DELETE CASCADE,
  surface           TEXT    NOT NULL,
  reason            TEXT,
  dismissed_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at        TIMESTAMP WITH TIME ZONE NOT NULL  -- +30 days
);

CREATE INDEX idx_dismissals_tenant ON integration_recommendation_dismissals(tenant_id);
CREATE INDEX idx_dismissals_workspace ON integration_recommendation_dismissals(workspace_id);
CREATE INDEX idx_dismissals_user ON integration_recommendation_dismissals(user_id);
CREATE INDEX idx_dismissals_integration ON integration_recommendation_dismissals(integration_id);
CREATE INDEX idx_dismissals_expires ON integration_recommendation_dismissals(expires_at);

-- -------------------------------------------------------------------------
-- 3. Admin pin/suppression rules (workspace-scoped)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_rules (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id      INTEGER NOT NULL REFERENCES projects(tenant_id) ON DELETE CASCADE,
  integration_id    INTEGER NOT NULL REFERENCES integration_credentials(id) ON DELETE CASCADE,
  rule_type         TEXT NOT NULL,  -- 'pin' or 'suppress'
  rule_position     INTEGER,          -- 1-3 for pin priority (null if suppressed)
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rules_workspace ON integration_recommendation_rules(workspace_id);
CREATE INDEX idx_rules_integration ON integration_recommendation_rules(integration_id);
CREATE INDEX idx_rules_type ON integration_recommendation_rules(rule_type);