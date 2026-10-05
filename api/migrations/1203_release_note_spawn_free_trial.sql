-- 1203 · Release note: Spawn's free week.
--
-- `new`: a player who has cleared Spawn's 13+ line can start a 7-day free trial from
-- their account page, no card, with Builderforce's free-plan monthly tokens
-- (`application/spawn/spawnTrial.ts`). One per person (`users.spawn_trial_at`, 1202)
-- and one per workspace. The player names a grown-up, who gets an email when it starts,
-- halfway, on its last day and when it ends, each carrying a signed link to
-- `/spawn/parent`, where they can join or top up without the player's password.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001203',
    '2026.10.16',
    'Spawn: try it free for a week',
    'New Spawn players can now build free for 7 days with 50,000 tokens, about four builds, and no card. Start it from your Spawn account page and add a grown-up''s email: they get a short note when the trial starts, halfway through, the day before it ends and when it ends, each with a link to their own Spawn page, where they can keep it going for $1.99 a month or add tokens without needing your password. One free trial per person. Start at spawn.builderforce.ai.',
    'new',
    'live',
    '2026-10-05 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
