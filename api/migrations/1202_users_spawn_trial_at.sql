-- 1202 · `users.spawn_trial_at` — one Spawn free trial per person.
--
-- Spawn (spawn.builderforce.ai) gives a 7-day free trial with the free plan's tokens
-- (application/spawn/spawnTrial.ts). The trial window itself lives on the workspace's
-- membership row; THIS column is the person-level fact "has already had a trial", so a
-- second workspace does not mint a second trial. Claimed atomically with
-- `UPDATE … WHERE spawn_trial_at IS NULL`. NULL = never trialled.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS spawn_trial_at timestamptz;
