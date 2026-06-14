-- Migration: Studio voice cloning (Voice PRD #1994)
--
-- A voice clone is an enrolled identity: a reference sample in R2 + a cached
-- speaker embedding. Synthesis output is persisted to studio_voiceovers, which
-- doubles as the read-through synthesis cache (unique cache_key =
-- sha256(cloneId + normalizedText + speed + lang)) so identical re-synthesis is
-- free + instant. Licenses let one tenant use another's published clone.
-- Consent (PRD §5 / ToS §9a) is a nullable attestation timestamp; synthesis is
-- gated on it. Idempotent so a migration-only DB can re-run safely.

DO $$ BEGIN
  CREATE TYPE voice_clone_visibility AS ENUM ('private', 'unlisted', 'marketplace');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voice_clone_status AS ENUM ('draft', 'ready', 'published');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS studio_voice_clones (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id           UUID REFERENCES segments(id) ON DELETE CASCADE,
  user_id              VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  name                 VARCHAR(255) NOT NULL,
  description          TEXT,
  provider             VARCHAR(64) NOT NULL DEFAULT 'ssm-webgpu',
  reference_key        VARCHAR(512),
  embedding            JSONB,
  visibility           voice_clone_visibility NOT NULL DEFAULT 'private',
  status               voice_clone_status NOT NULL DEFAULT 'ready',
  price_millicents     INTEGER NOT NULL DEFAULT 0,
  consent_attested_at  TIMESTAMP,
  consent_text_version VARCHAR(32),
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio_voice_clones_tenant ON studio_voice_clones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_studio_voice_clones_visibility ON studio_voice_clones(visibility);

CREATE TABLE IF NOT EXISTS studio_voice_clone_licenses (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  clone_id   INTEGER NOT NULL REFERENCES studio_voice_clones(id) ON DELETE CASCADE,
  status     VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_clone_license ON studio_voice_clone_licenses(clone_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_clone_licenses_tenant ON studio_voice_clone_licenses(tenant_id);

CREATE TABLE IF NOT EXISTS studio_voiceovers (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clone_id           INTEGER NOT NULL REFERENCES studio_voice_clones(id) ON DELETE CASCADE,
  cache_key          VARCHAR(64) NOT NULL,
  text               TEXT NOT NULL,
  audio_key          VARCHAR(512) NOT NULL,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  word_timestamps    JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_usd_millicents INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_voiceovers_cache_key ON studio_voiceovers(cache_key);
CREATE INDEX IF NOT EXISTS idx_studio_voiceovers_clone ON studio_voiceovers(clone_id);
