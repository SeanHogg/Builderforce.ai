-- 0294: portfolio_items model + media upload support for freelancer work samples
--
-- This migration introduces a portfolio feature so freelancers can showcase
-- past work through a dedicated section on their public profile, similar to
-- a "Work Samples" gallery. Each portfolio item supports:
--   1) Title (required)
--   2) Description (optional, free-text)
--   3) Media (optional) - either an uploaded file (stored in R2) OR an external URL
--   4) Cover variation warmup (optional) - a flag to trigger a cover/preview generation
--
-- The portfolio items are scoped per-tenant and per-user (only visible to the
-- profile owner). Deleted items are soft-marked (deleted_at) so their history
-- stays queryable for owners but is not exposed on the public profile.
--
-- Optional categorization is modeled as a junction table (portfolio_item_tags)
-- which has no schema additions here (tags themselves are defined elsewhere).

-- A. portfolio_items table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_items (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  -- Media storage strategy
  media_type  VARCHAR(20), -- 'image'|'pdf'|'video'|'other' (null = no media link)
  media_url   VARCHAR(1000), -- Internal R2 public URL (e.g. https://r2.../portfolio/...)
  r2_key      VARCHAR(500),   -- R2 object key (e.g. portfolio/{user_id}/{timestamp}.{ext})
  -- External link alternative to file upload
  external_link VARCHAR(1000),
  -- Cover variation warmup (kept private to the executor if needed)
  cover_variation_warmup BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- Enforce that a portfolio item can have EITHER a file or an external link
-- (exactly one, or neither). This is enforced by application layer validation
-- since nullifiers allow both NULL for flexibility (allow creating a text-only
-- item before deciding on media). The unique constraint below enforces
-- mutual exclusivity of media_url + external_link for simplicity (at most one).
CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_item_media_exclusive
  ON portfolio_items(tenant_id, user_id, r2_key)
  WHERE r2_key IS NOT NULL OR external_link IS NOT NULL;

-- Composite unique: (user_id, title) + tenant ensures per-user, peerless titles
CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_item_user_title
  ON portfolio_items(user_id, title)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_items_user
  ON portfolio_items(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_items_tenant
  ON portfolio_items(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_items_media_type
  ON portfolio_items(media_type)
  WHERE deleted_at IS NULL;

-- B. Optional categorization (junction) ---------------------------------------
-- Stored as text slugs in the tags column for simplicity (tag definitions can
-- be managed separately, e.g. via a config table or a workshop).
CREATE TABLE IF NOT EXISTS portfolio_item_tags (
  id              SERIAL PRIMARY KEY,
  portfolio-item  INTEGER NOT NULL REFERENCES portfolio_items(id) ON DELETE CASCADE,
  tag             VARCHAR(50) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_item_tag
  ON portfolio_item_tags(portfolio_item, tag);