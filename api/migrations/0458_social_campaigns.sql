-- 0458_social_campaigns.sql
-- Publishing to the workspace's OWN social accounts from the canvas.
--
-- A social account is a `connector_connections` row (the built-in X / LinkedIn /
-- Facebook / Instagram / TikTok manifests), so there is no new credential store here.
-- What is new is the campaign: a named body, per-network copy variants, and one row
-- per (campaign, account) recording what was actually published.
--
-- NOT folded into `marketing_campaigns`: that table requires an audience and a
-- DNS-verified sender identity and carries suppression and unsubscribe tokens, none
-- of which exist for a post to a Page you own.

CREATE TABLE IF NOT EXISTS social_campaigns (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  link_url      VARCHAR(1000) NOT NULL DEFAULT '',
  media_urls    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Per-network copy, keyed by network. Absent key falls back to `body`.
  variants      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(16) NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMP,
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  targets       INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  session_id    UUID REFERENCES creation_sessions(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_social_campaign_status
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_tenant_status
  ON social_campaigns(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS social_campaign_posts (
  id            BIGSERIAL PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES social_campaigns(id) ON DELETE CASCADE,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  network       VARCHAR(16) NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  status        VARCHAR(16) NOT NULL DEFAULT 'queued',
  external_id   VARCHAR(255),
  permalink     VARCHAR(1000),
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  published_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_social_post_status
    CHECK (status IN ('queued', 'published', 'pending', 'failed', 'skipped'))
);

-- Idempotency: a resumed or retried run cannot post the same campaign to the same
-- account twice. On a public feed a duplicate is not a recoverable mistake.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_campaign_connection
  ON social_campaign_posts(campaign_id, connection_id);

CREATE INDEX IF NOT EXISTS idx_social_posts_campaign_status
  ON social_campaign_posts(campaign_id, status);
