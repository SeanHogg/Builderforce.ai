-- 1084 — Give the round table's POWER METER a real cap instead of a magic number.
--
-- `CeremonyStage.DEFAULT_CAP = 8` was a hardcoded per-member WIP ceiling used
-- whenever a member profile did not set one — which is almost always, because
-- `member_profiles.max_concurrent_wip` is optional and rarely filled in. So the
-- meter that tells a standup "this person is overloaded" was, for nearly everyone,
-- comparing their live load against a number nobody chose and nobody could change.
-- A team whose normal WIP is 3 saw every member sitting comfortably at 40%.
--
-- The cap belongs to the BOARD, next to the other ceremony settings the board
-- already owns (`standup_turn_mode`, `standup_turn_seconds`) — it is a property of
-- how this team works, decided once, not of each individual. A member profile that
-- DOES set its own cap still wins: this is the default the meter falls back to,
-- which is exactly the role the constant was playing, now editable and inspectable.
--
-- Defaulted to 8 on purpose: preserving the constant's value means no board's meter
-- changes reading on the day this ships. What changes is that the number is now
-- somebody's decision rather than a literal in a component.

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS default_member_wip_cap INTEGER NOT NULL DEFAULT 8;
