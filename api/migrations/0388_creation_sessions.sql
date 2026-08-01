-- Creation Sessions: durable tenant-owned canvases that unify chat, workflows,
-- projects, websites, data, agents, and generated artifacts. Canvas rows store
-- only placement/native content; canonical app resources remain referenced.

CREATE TABLE IF NOT EXISTS creation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled session',
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  canvas_revision BIGINT NOT NULL DEFAULT 0,
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  preview JSONB,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creation_sessions_tenant_activity
  ON creation_sessions(tenant_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_sessions_creator
  ON creation_sessions(created_by, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_sessions_segment
  ON creation_sessions(tenant_id, segment_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS creation_session_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  resource_type VARCHAR(64),
  resource_id VARCHAR(128),
  resource_revision VARCHAR(128),
  canvas_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_objects_session
  ON creation_session_objects(session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_creation_objects_resource
  ON creation_session_objects(session_id, resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS creation_session_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  source_object_id UUID NOT NULL REFERENCES creation_session_objects(id) ON DELETE CASCADE,
  target_object_id UUID NOT NULL REFERENCES creation_session_objects(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL DEFAULT 'reference',
  label VARCHAR(255),
  metadata JSONB,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_connections_session
  ON creation_session_connections(session_id, created_at);

CREATE TABLE IF NOT EXISTS creation_session_members (
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('viewer', 'commenter', 'editor', 'runner', 'owner')),
  invited_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  last_seen_revision BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_creation_members_user
  ON creation_session_members(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS creation_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'user',
  actor_ref VARCHAR(128),
  event_type VARCHAR(64) NOT NULL,
  object_id UUID REFERENCES creation_session_objects(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_creation_events_idempotency
  ON creation_session_events(session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creation_events_session_revision
  ON creation_session_events(session_id, revision);

CREATE TABLE IF NOT EXISTS creation_session_project_links (
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_creation_project_links_project
  ON creation_session_project_links(project_id, created_at DESC);
