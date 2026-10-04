-- 1200 · Release note: Spawn — build Roblox games by talking.
--
-- `new`: Spawn (spawn.builderforce.ai) is a new product for Roblox creators 13 and up:
-- a desktop app that installs its own Roblox Studio plugin and turns a description into
-- parts, Luau and UI inside Studio, one undo step per build (`desktop/spawn`,
-- `desktop/crates/bf-roblox`). Builds run through `/api/spawn/build`, behind a 13+ age
-- line, a $1.99/month membership and a prepaid token wallet topped up in $10/$20/$50/$100
-- packs (`application/spawn/`). Failed or refused builds are not charged.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001200',
    '2026.10.10',
    'Spawn: build Roblox games by talking',
    'Spawn is a new Builderforce app for Roblox creators 13 and up. Describe the game you want (an obby, a tycoon, a simulator, a race track) and Spawn builds the parts, writes the Luau and makes the UI right inside Roblox Studio. It installs its own Studio plugin, reads the place you have open so new things fit, and applies every build as one undo step. Press Play, and errors from the play-test come back with a one-click fix. Scripts that call the internet, run hidden code or load assets by id are refused before they reach the game. Membership is $1.99 a month; tokens come in packs from $10, and builds that fail are free. Start at spawn.builderforce.ai.',
    'new',
    'live',
    '2026-10-04 23:00:00'
  )
ON CONFLICT (id) DO NOTHING;
