-- 1144 · Release note for the canvas artifact walkthrough.
--
-- `new`, not `improvement`. A generated board could not explain itself at all before
-- this: the objects arrived, and the only ordering anybody had was the order the agents
-- happened to finish in. The walkthrough is a thing that did not exist — it groups what
-- was made, orders it by what feeds what, and moves the viewport one stop at a time.
-- It is not a repaired regression, so it is news.
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
    'a1b2c301-0009-4000-8000-000000000010',
    '2026.9.15',
    'Twenty-four things landed on your board. Now something walks you round them.',
    'Paste a plan into a canvas, address it to five agents, and four minutes later there are two dozen objects on the board — a company profile, six researched competitors, two sized segments, a pricing model, a map. That is the product working exactly as intended, and it is also the moment people freeze: twenty-four objects is more than anyone reads at once, and a board gives you no reason to open any particular card first. The walkthrough is the answer to *where do I start*. Press it and the canvas takes you round what was made, one stop at a time — it groups the objects into the sets they actually belong to, orders those sets by what feeds what rather than by which agent finished first, and moves the viewport to each stop so you are looking at the thing being described instead of hunting for it. Every stop says what the object is for and what it was built from, so a competitor card arrives with the research behind it rather than as a name and a number. It is offered on any board with something on it, and it is a tour of YOUR artefacts — not a tour of the buttons around them. The product tour that explains the chrome is a different thing and stayed a different thing; this one only ever talks about what you made.',
    'new',
    'live',
    '2026-09-07 16:20:00'
  )
ON CONFLICT (id) DO NOTHING;
