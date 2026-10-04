-- 1198 · `users.birth_month` — Spawn's 13+ line.
--
-- Spawn (spawn.builderforce.ai) builds Roblox games and is for players 13 and older,
-- the COPPA line and Roblox's own. The age check asks once for a birth MONTH and keeps
-- it as that month's first day: the month is all the check needs, and the day is
-- personal data about a young person that nothing would ever read. NULL = never asked.
--
-- On the person, not the workspace: one workspace can hold a parent and a teenager.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_month date;
