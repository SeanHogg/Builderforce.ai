-- 1314 · Release notes: a board earns its budget, and teammates have a profile.
--
-- Two `new` entries. (1) Every ticket that reaches Done earns its board budget in points, shown
-- in an Earned budget panel on the board with run spend beside it, and the milestones a board
-- reaches (an epic completing, a release shipping) roll up to the investor update. (2) Each
-- teammate has a profile page (personality and work summary), linked from the board hovercard and
-- the members directory, and the @-mention list shows a one-line personality read per person.
--
-- Fixed ids so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces each exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0014-4000-8000-000000001314',
    '2026.10.141',
    'A board now earns its budget, and delivery reaches the investor update',
    'Finishing work used to leave no trace on the board that did it. Now every ticket that reaches Done earns its board budget, in points: the ticket''s story points, or one point when it was never estimated. A reopened ticket never pays twice. Open Earned budget from the board toolbar to see what the board has earned, what its runs have cost, its recent earnings and the milestones it has reached. A milestone is an epic that completed or a release that shipped, and each one carries the points its tickets earned. Those milestones now feed the investor update, so a line about delivery has a board and a number behind it.',
    'new',
    'live',
    '2026-11-08 10:00:00'
  ),
  (
    'a1b2c301-0015-4000-8000-000000001314',
    '2026.10.142',
    'Every teammate has a profile page, and mentions show who you are talking to',
    'Your teammates now have a page of their own: name, avatar, role in your workspace, personality, and a summary of their work, with open tickets, what they touched in the last thirty days and what they have finished. It is visible to people in the same workspace and nobody else. Reach it from the personality hovercard on the board or from the members directory. When you type @ to direct a message, each person in the list now shows a one-line read of their personality, such as their type and strongest trait. It comes from the same data the hovercard uses, loaded once, so the list opens as fast as before.',
    'new',
    'live',
    '2026-11-08 10:05:00'
  )
ON CONFLICT (id) DO NOTHING;
