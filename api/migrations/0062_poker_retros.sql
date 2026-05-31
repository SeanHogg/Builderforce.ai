-- Migration: Planning Poker + Retrospectives (doc 03). Segment-scoped with the
-- 0056 trigger. These are nested session models (session→stories→votes,
-- retro→items) with vote/reveal actions — the "live" feel comes from the client
-- polling the session detail (no WebSocket infra required for a functional v1).

CREATE TABLE IF NOT EXISTS poker_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  voting_system  VARCHAR(20) NOT NULL DEFAULT 'fibonacci',
  status         VARCHAR(20) NOT NULL DEFAULT 'active',     -- active|completed|archived
  facilitator_id VARCHAR(64),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_poker_sessions_segment ON poker_sessions;
CREATE TRIGGER trg_poker_sessions_segment BEFORE INSERT ON poker_sessions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_poker_sessions_segment ON poker_sessions(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS poker_stories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  session_id     UUID NOT NULL REFERENCES poker_sessions(id) ON DELETE CASCADE,
  title          VARCHAR(500) NOT NULL,
  description    TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending|voting|revealed|estimated|skipped
  final_estimate VARCHAR(20),
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_poker_stories_segment ON poker_stories;
CREATE TRIGGER trg_poker_stories_segment BEFORE INSERT ON poker_stories FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_poker_stories_session ON poker_stories(tenant_id, segment_id, session_id);

CREATE TABLE IF NOT EXISTS poker_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  story_id    UUID NOT NULL REFERENCES poker_stories(id) ON DELETE CASCADE,
  user_id     VARCHAR(64) NOT NULL,
  value       VARCHAR(20) NOT NULL,
  is_revealed BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_poker_votes_segment ON poker_votes;
CREATE TRIGGER trg_poker_votes_segment BEFORE INSERT ON poker_votes FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE UNIQUE INDEX IF NOT EXISTS uq_poker_votes_story_user ON poker_votes(story_id, user_id);

CREATE TABLE IF NOT EXISTS retrospectives (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  template   VARCHAR(30) NOT NULL DEFAULT 'start_stop_continue',
  status     VARCHAR(20) NOT NULL DEFAULT 'active',          -- active|completed
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_retrospectives_segment ON retrospectives;
CREATE TRIGGER trg_retrospectives_segment BEFORE INSERT ON retrospectives FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_retrospectives_segment ON retrospectives(tenant_id, segment_id, status);

CREATE TABLE IF NOT EXISTS retro_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  retro_id   UUID NOT NULL REFERENCES retrospectives(id) ON DELETE CASCADE,
  category   VARCHAR(40) NOT NULL,
  content    TEXT NOT NULL,
  author_id  VARCHAR(64),
  votes      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_retro_items_segment ON retro_items;
CREATE TRIGGER trg_retro_items_segment BEFORE INSERT ON retro_items FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_retro_items_retro ON retro_items(tenant_id, segment_id, retro_id);
