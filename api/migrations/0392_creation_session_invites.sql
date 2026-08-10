-- Auditable, expiring Creation Session invitations. Raw tokens are returned
-- once and never persisted; only their SHA-256 digest is stored.
CREATE TABLE IF NOT EXISTS creation_session_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'runner', 'owner')),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_session_invites_session
  ON creation_session_invites(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_session_invites_email
  ON creation_session_invites(tenant_id, LOWER(email), expires_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
