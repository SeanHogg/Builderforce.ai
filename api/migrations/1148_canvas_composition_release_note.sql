-- 1148 · Release note for canvas composition — a canvas, run as one step on another.
--
-- `new`, and it clears the bar without argument: before this pass there was no way
-- to express one canvas inside another anywhere in the stack. `CREATION_OBJECT_KINDS`
-- had no kind referencing another canvas, `WorkflowNodeKind` had ~60 kinds and none
-- of them called another workflow, and a board resolved exactly one flow — its own.
-- A shared sequence had to be redrawn in every flow that needed it.
--
-- Fixed id so the migration is safe to replay, `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
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
    'a1b2c301-0009-4000-8000-000000000013',
    '2026.9.19',
    'A canvas can now run inside another canvas',
    'Draw the offboarding flow once — revoke the accounts, run the final payroll, chase the laptop, tell the team — and then place that whole canvas as a single step in the promotion flow, the leaver flow, and anywhere else it belongs. `Run a canvas` is a step like any other: drop it on the board, choose a canvas, connect it. It tells you on the spot what that canvas accepts and what it hands back, read off the child board itself rather than a contract card somebody has to remember to update — a parameter is what an entry step declares it needs, a return is a variable nothing inside that board consumes. You choose how it binds. Snapshot copies the child''s steps into your flow when you build, so what you shipped is what runs and later edits over there change nothing here until you build again. Live stores a reference to the child''s own build and resolves it on every run, so you fix the payroll step once in its own canvas and every flow that calls it is right on the next run. The nested steps appear in the parent''s own timeline under the child canvas''s name — one run to watch, one approval gate, one place to look. And nothing fails quietly: a canvas that cannot be read, one with no steps in it, one holding a step that still needs a prompt, a board that reaches itself, or composition nested more than five deep all stop the build with a message naming the canvas, because a step that runs, reports success and does not do the work is worse than one that will not build. Every organisation has eight of these — onboarding, offboarding, procurement approval, incident comms, contract renewal — each appearing inside a dozen larger ones. They were always the same flow. Now they are the same object.',
    'new',
    'live',
    '2026-09-07 19:00:00'
  )
ON CONFLICT (id) DO NOTHING;
