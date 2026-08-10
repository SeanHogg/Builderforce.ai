-- Creation Session completion: durable attention preferences, object leases,
-- reusable tenant templates, and server-owned branch ancestry.

ALTER TABLE creation_sessions
  ADD COLUMN IF NOT EXISTS branch_parent_session_id UUID REFERENCES creation_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_base_revision BIGINT;

-- Soft deletion retains snapshots/events for the configured recovery window.
ALTER TABLE creation_sessions
  DROP CONSTRAINT IF EXISTS creation_sessions_status_check;
ALTER TABLE creation_sessions
  ADD CONSTRAINT creation_sessions_status_check
  CHECK (status IN ('active', 'archived', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_creation_sessions_branch_parent
  ON creation_sessions(branch_parent_session_id)
  WHERE branch_parent_session_id IS NOT NULL;

ALTER TABLE creation_session_members
  ADD COLUMN IF NOT EXISTS watch_state VARCHAR(24) NOT NULL DEFAULT 'mentions'
    CHECK (watch_state IN ('all', 'mentions', 'muted')),
  ADD COLUMN IF NOT EXISTS following_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE creation_session_objects
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_creation_objects_active_locks
  ON creation_session_objects(session_id, lock_expires_at)
  WHERE lock_expires_at IS NOT NULL;

-- This projection is populated by the API from display-only fields (title,
-- subtitle, status and resource label). Raw object JSON is intentionally never
-- indexed because it can contain imported rows, prompts or credentials.
UPDATE creation_session_objects
SET search_text = LEFT(TRIM(CONCAT_WS(' ',
  CASE WHEN jsonb_typeof(content->'title') = 'string' THEN content->>'title' ELSE NULL END,
  CASE WHEN jsonb_typeof(content->'subtitle') = 'string' THEN content->>'subtitle' ELSE NULL END,
  CASE WHEN jsonb_typeof(content->'status') = 'string' THEN content->>'status' ELSE NULL END,
  CASE WHEN jsonb_typeof(content->'label') = 'string' THEN content->>'label' ELSE NULL END
)), 2000)
WHERE search_text = '';

CREATE INDEX IF NOT EXISTS idx_creation_objects_search
  ON creation_session_objects USING GIN (to_tsvector('simple', search_text));

CREATE TABLE IF NOT EXISTS creation_session_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  category VARCHAR(80) NOT NULL DEFAULT 'Custom',
  graph JSONB NOT NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'tenant')),
  marketplace_listing_id VARCHAR(128),
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_templates_tenant_updated
  ON creation_session_templates(tenant_id, segment_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_templates_marketplace
  ON creation_session_templates(marketplace_listing_id)
  WHERE marketplace_listing_id IS NOT NULL;

-- Idempotent device-local → account claim. The browser-generated local id is
-- opaque and scoped to the claiming user; retries return the same server row.
CREATE TABLE IF NOT EXISTS creation_session_claims (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_session_id VARCHAR(160) NOT NULL,
  server_session_id UUID NOT NULL UNIQUE REFERENCES creation_sessions(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, client_session_id)
);
