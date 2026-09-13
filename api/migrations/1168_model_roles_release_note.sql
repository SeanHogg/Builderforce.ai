-- 1168 · Release note: analysis on your chosen order, code on your strongest connected model —
-- and a model that breaks mid-answer no longer ends the run.
--
-- `improvement`, not `new`: connected accounts already served every turn. What changed is WHICH
-- connected model serves which turn (routing by role, 1167), plus a fix for Grok runs that stopped
-- partway through.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay, `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001168',
    '2026.9.30',
    'Your strongest model writes the code',
    'When you connect several accounts, your agents now use each one for what it is best at. Reading the codebase and planning follow the order you set in Settings → Bring your own models. The moment the work turns into a code change, that edit goes to the strongest model you have connected, and it stays there for the rest of the run. Once your runs build a track record, that job goes to whichever connected model has actually delivered the most accepted code for you, and work done in VS Code now counts toward that record. Quick lookups go to your cheapest model. It is automatic, and a model you pin yourself is never swapped. Runs are sturdier too: if a model fails partway through an answer, as long Grok runs sometimes did, the turn is retried once on another connected account instead of the run stopping. The model name in the VS Code composer now shows the model that actually answered.',
    'improvement',
    'live',
    '2026-09-12 23:55:00'
  )
ON CONFLICT (id) DO NOTHING;
