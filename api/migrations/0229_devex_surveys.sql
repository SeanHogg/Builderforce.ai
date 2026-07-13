-- 0229_devex_surveys.sql
-- DevEx Surveys & Insights (ROADMAP EMP-15): an internal developer-experience
-- pulse-survey framework + the insights lens that reads it ("AI DevEx Analysis").
--
-- Three tables, all tenant-scoped (and segment-aware via a nullable segment_id):
--   devex_survey_templates — a named set of questions (jsonb).
--   devex_campaigns         — a template sent to the workspace for a period.
--   devex_responses         — one submission per respondent per campaign; answers
--                             keyed by question id. Anonymous campaigns store a
--                             respondent_hash (NOT user_id) so submissions are
--                             dedupable without being identifiable.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS so it is safe to re-run.

CREATE TABLE IF NOT EXISTS devex_survey_templates (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  name        VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  questions   JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  VARCHAR(36),
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devex_templates_tenant ON devex_survey_templates (tenant_id);

CREATE TABLE IF NOT EXISTS devex_campaigns (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  template_id  INTEGER REFERENCES devex_survey_templates(id) ON DELETE SET NULL,
  title        VARCHAR(200) NOT NULL,
  period_month VARCHAR(7),
  status       VARCHAR(16) NOT NULL DEFAULT 'open',
  anonymous    BOOLEAN NOT NULL DEFAULT TRUE,
  opened_at    TIMESTAMP NOT NULL DEFAULT now(),
  closed_at    TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devex_campaigns_tenant ON devex_campaigns (tenant_id);

CREATE TABLE IF NOT EXISTS devex_responses (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id     INTEGER NOT NULL REFERENCES devex_campaigns(id) ON DELETE CASCADE,
  respondent_hash VARCHAR(64),
  user_id         VARCHAR(36),
  answers         JSONB NOT NULL DEFAULT '{}',
  submitted_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devex_responses_tenant ON devex_responses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_devex_responses_campaign ON devex_responses (campaign_id);
-- A real UNIQUE on (campaign_id, respondent_hash) WHERE respondent_hash IS NOT NULL
-- is awkward to express idempotently across re-runs; a plain composite index gives
-- the lookup the dedup check (one submission per respondent) needs.
CREATE INDEX IF NOT EXISTS idx_devex_responses_dedup ON devex_responses (campaign_id, respondent_hash);
