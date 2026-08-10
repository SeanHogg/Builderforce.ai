-- Game targets — where a canvas-authored game actually gets played.
--
-- WHY: `creative.game` could already AUTHOR a game (one self-contained HTML
-- document, generated from a brief) but the result was a FILE and nothing else.
-- It could not be played without leaving the canvas, could not be installed on
-- the phone the person asking for a game had in mind, and had no relationship to
-- Roblox — which, for anyone under about fifteen, is what "make a video game"
-- means. "Make me a game" and "give me a .html" are not the same request.
--
-- The gap is closed by a PORT (application/game/gameTarget.ts) with five
-- adapters, each an honest answer to "played where?": `web` (a sandboxed frame on
-- the canvas), `pwa` (installed to an Android or iOS home screen from a published
-- address), `android` and `ios` (a real Capacitor app built by a generated
-- Action), and `roblox` (the brief re-authored in Luau as a real .rbxlx place).
--
-- This table is the per-project record of which of those have been materialised,
-- what they produced, and — for Roblox — which live experience the publish
-- overwrites. One row per (project, game, target).
--
-- No new secret store: the Roblox API key is a `project_secrets` row like every
-- other backend credential, so there is one vault, one sealing contract and one
-- read discipline in the platform.

CREATE TABLE IF NOT EXISTS project_game_targets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The game's file-safe stem. A project can hold several games (a canvas is a
  -- workspace, not one artifact), and the slug is what separates their
  -- directories, their workflow file names and their PWA caches.
  slug           VARCHAR(64) NOT NULL,
  -- The title as authored, kept so the UI can list targets without reading R2.
  title          VARCHAR(200) NOT NULL DEFAULT '',

  -- A GameTargetKey: 'web' | 'pwa' | 'android' | 'ios' | 'roblox'.
  -- Deliberately no CHECK constraint — a sixth target (a desktop wrapper, a
  -- console export) should land as an adapter, not as a migration.
  target         VARCHAR(24) NOT NULL,

  status         VARCHAR(24) NOT NULL DEFAULT 'materialized',
  -- Where the target's files were written in the project workspace. Stored
  -- rather than recomputed because `android` and `ios` deliberately SHARE one
  -- directory, so it cannot be derived from the target key alone.
  directory      VARCHAR(256) NOT NULL DEFAULT '',
  file_count     INTEGER NOT NULL DEFAULT 0,
  -- Where it can be played, when that is a URL. Null for targets whose output is
  -- a build artifact rather than an address.
  play_url       TEXT,
  detail         TEXT,
  -- The SetupStep[] the adapter returned: what the human still has to do. Stored
  -- so the panel can show remaining work without re-running materialisation,
  -- which for `roblox` costs a model call.
  setup_steps    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Roblox Open Cloud publish target. Both are numeric ids from an experience
  -- that ALREADY EXISTS: Open Cloud can replace a place's contents but cannot
  -- create an experience, so the first publish is always a human in Studio.
  roblox_universe_id VARCHAR(32),
  roblox_place_id    VARCHAR(32),
  -- The version number Roblox returned on the last successful publish.
  roblox_version     INTEGER,

  last_published_at TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Materialising is idempotent: re-running a target overwrites its row rather
  -- than accumulating history. The files it wrote are the artifact; a second row
  -- describing the same directory would only ever disagree with the first.
  CONSTRAINT uq_project_game_targets UNIQUE (project_id, slug, target)
);

CREATE INDEX IF NOT EXISTS idx_project_game_targets_project ON project_game_targets (project_id);
CREATE INDEX IF NOT EXISTS idx_project_game_targets_tenant ON project_game_targets (tenant_id);
