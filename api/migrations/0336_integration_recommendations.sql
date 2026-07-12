-- 0336_integration_recommendations.sql
-- PRD #336: Recommendations for Missing Integrations
--
-- Model notes:
-- * The catalog of installable integrations is the integration_provider enum
--   (github, gitlab, bitbucket, jira, confluence, freshservice, freshdesk,
--   servicenow, linear, sentry, pagerduty, monday, asana, clickup, rally, etc.)
--   plus the board provider catalog. Each provider is identified by a stable TEXT
--   id (e.g. 'github'), NOT by a row in integration_credentials — credentials
--   rows are per-tenant auth material (UUID PK). So recommendation tables key on
--   provider TEXT.
-- * Gap detection = catalog \ credentials(tenant, project?, is_enabled).
-- * Workspace maps to projects.id (a board). We keep project_id nullable for
--   tenant-wide recommendations (marketplace surface) and required for
--   project-scoped (in_context) surfaces.
-- * Schema mirrors prior migrations' segment_id pattern being optional — here we
--   don't need segment_id because recommendation rules are workspace (project)
--   scoped and cross-segment shouldn't shard.

-- -------------------------------------------------------------------------
-- 1) Recommendation events (analytics + attribution: FR-6)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_events (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = tenant-wide
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,  -- e.g. 'github','jira','slack' — matches integration_provider values but kept TEXT for forward-compat
  surface           TEXT    NOT NULL CHECK (surface IN ('marketplace','onboarding','in_context','email')),
  event_type        TEXT    NOT NULL CHECK (event_type IN ('impression','click','dismissed','installed_from_recommendation')),
  reason            TEXT,              -- dismiss reason (optional picklist value)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_events_tenant         ON integration_recommendation_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_project        ON integration_recommendation_events(project_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_user           ON integration_recommendation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_provider       ON integration_recommendation_events(provider);
CREATE INDEX IF NOT EXISTS idx_rec_events_surface         ON integration_recommendation_events(surface);
CREATE INDEX IF NOT EXISTS idx_rec_events_type            ON integration_recommendation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rec_events_created         ON integration_recommendation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_events_tenant_provider ON integration_recommendation_events(tenant_id, provider);

-- -------------------------------------------------------------------------
-- 2) Dismissal history (FR-4: 30-day debounce, per user+surface+provider)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_dismissals (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,
  surface           TEXT    NOT NULL CHECK (surface IN ('marketplace','onboarding','in_context','email','all')),
  reason            TEXT,
  dismissed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_rec_dismiss_tenant         ON integration_recommendation_dismissals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rec_dismiss_project        ON integration_recommendation_dismissals(project_id);
CREATE INDEX IF NOT EXISTS idx_rec_dismiss_user           ON integration_recommendation_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_dismiss_provider       ON integration_recommendation_dismissals(provider);
CREATE INDEX IF NOT EXISTS idx_rec_dismiss_expires        ON integration_recommendation_dismissals(expires_at);
-- Fast path: find active dismissals for a user (non-expired)
CREATE INDEX IF NOT EXISTS idx_rec_dismiss_active
  ON integration_recommendation_dismissals(user_id, provider, surface, expires_at)
  WHERE expires_at > NOW();

-- -------------------------------------------------------------------------
-- 3) Admin pin/suppress rules per workspace (project) — FR-5
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_rules (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,
  rule_type         TEXT    NOT NULL CHECK (rule_type IN ('pin','suppress')),
  rule_position     INTEGER CHECK (rule_position >= 1 AND rule_position <= 3),  -- 1-3 for pin priority, NULL for suppress
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rec_rules_project_provider UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_rec_rules_tenant          ON integration_recommendation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rec_rules_project         ON integration_recommendation_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_rec_rules_provider        ON integration_recommendation_rules(provider);
CREATE INDEX IF NOT EXISTS idx_rec_rules_type            ON integration_recommendation_rules(rule_type);

-- -------------------------------------------------------------------------
-- 4) Weekly digest email suppression / state (FR-7)
--    Per-tenant user-level unsubscribe for recommendation emails (reuses
--    standard unsubscribe token model if present; this table stores only the
--    opt-out flag so global caps can be respected downstream).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_recommendation_email_suppressions (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unsubscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rec_email_suppress_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rec_email_supp_tenant ON integration_recommendation_email_suppressions(tenant_id);
