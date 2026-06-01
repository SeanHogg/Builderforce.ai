-- Migration: Unified contributor activity calendar + public Prompt Library.
--
-- 1) Make AI agents first-class contributors so the activity calendar can merge
--    human contributors (git/PR activity) and CoderClaw agents (telemetry) on one
--    GitHub-style heatmap. `kind` distinguishes the two; `claw_id` links an agent
--    contributor back to its coderclaw_instances row so telemetry/tool-audit rows
--    (keyed by claw_id) roll up into that contributor's daily activity.
--
-- 2) Prompt Library — versioned prompt templates with a public gallery. Entries
--    are authored within a tenant but can be published (visibility='public') so
--    anyone can browse and "use" them. Versions are immutable; stars track likes.

-- ── 1. Unify agents into contributors ──────────────────────────────────────
ALTER TABLE contributors
  ADD COLUMN IF NOT EXISTS kind    VARCHAR(16) NOT NULL DEFAULT 'human',  -- 'human' | 'agent'
  ADD COLUMN IF NOT EXISTS claw_id INTEGER REFERENCES coderclaw_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contributors_claw ON contributors(tenant_id, claw_id);
CREATE INDEX IF NOT EXISTS idx_contributors_kind ON contributors(tenant_id, kind);

-- ── 2. Prompt Library ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_library_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  slug            VARCHAR(255) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  category        VARCHAR(100),
  tags            TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  visibility      VARCHAR(16) NOT NULL DEFAULT 'private', -- 'private' | 'tenant' | 'public'
  author_user_id  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  author_name     VARCHAR(255),
  current_version INTEGER NOT NULL DEFAULT 1,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  star_count      INTEGER NOT NULL DEFAULT 0,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_prompt_tenant_slug UNIQUE (tenant_id, slug)
);
DROP TRIGGER IF EXISTS trg_prompt_entries_segment ON prompt_library_entries;
CREATE TRIGGER trg_prompt_entries_segment BEFORE INSERT ON prompt_library_entries FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
-- Stable, globally-unique public URLs: at most one public prompt per slug.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_public_slug ON prompt_library_entries(slug) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_prompt_entries_visibility ON prompt_library_entries(visibility, category);
CREATE INDEX IF NOT EXISTS idx_prompt_entries_tenant ON prompt_library_entries(tenant_id);

CREATE TABLE IF NOT EXISTS prompt_library_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  body        TEXT NOT NULL,                 -- the prompt template text
  variables   TEXT NOT NULL DEFAULT '[]',    -- JSON array of {name, description, default}
  model       VARCHAR(255),                  -- recommended model, if any
  notes       TEXT,                          -- changelog note for this version
  created_by  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_prompt_version UNIQUE (entry_id, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_entry ON prompt_library_versions(entry_id);

CREATE TABLE IF NOT EXISTS prompt_library_stars (
  entry_id   UUID NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
  user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entry_id, user_id)
);
