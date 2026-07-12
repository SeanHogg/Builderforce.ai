-- 0232_recommendations_space.sql
-- AI-driven Insights & Recommendations + SPACE metrics.
--
-- Recommendations are COMPUTED LIVE from the existing insight lenses (finance /\
-- engineering / allocation / DORA) by recommendationsEngine.computeRecommendations\
-- — they are not stored. The ONLY persisted state is per-recommendation dismissal\
-- so an acknowledged/dismissed recommendation stays hidden across reloads. A\
-- recommendation is identified by a stable rec_key (e.g. 'cost.per_pr_spike'); the\
-- engine filters out any key present here for the tenant.
--
-- SPACE metrics (spaceMetrics.ts) are likewise computed live from existing tables\
-- (member_metrics_period, deployment_events, run_model_outcomes, tasks) — no new\
-- storage. This migration therefore only adds the dismissal and feedback tables.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS so it is safe to re-run.

CREATE TABLE IF NOT EXISTS recommendation_dismissals (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rec_key       VARCHAR(120) NOT NULL,
  dismissed_by  VARCHAR(36),
  dismissed_at  TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rec_key)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_dismissals_tenant
  ON recommendation_dismissals (tenant_id);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rec_key       VARCHAR(120) NOT NULL,
  tenant_key    VARCHAR(120) NOT NULL,  -- stable rec_key for the tenant's dismissed set (used on refresh)
  user_id       VARCHAR(36) NOT NULL,   -- feedback contributor
  acted_upon    BOOLEAN DEFAULT FALSE, -- thumbs up/down signal
  acted_down    BOOLEAN DEFAULT FALSE,
  reason        TEXT,                   -- optional free-text reason
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_tenant
  ON recommendation_feedback (tenant_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_user_rec_key
  ON recommendation_feedback (tenant_id, rec_key);