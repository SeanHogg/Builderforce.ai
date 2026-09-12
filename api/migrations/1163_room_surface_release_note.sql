-- 1163 · Release note for the Room surface itself — the standup held on the board.
--
-- The surface shipped 2026-09-07 with its blog post (`stand-up-inside-your-board.md`)
-- but no `release_notes` row, so it never reached What's New or the digest; the Gap
-- Register logged that as needing a live superadmin session. It does not: release
-- notes ship as migrations (1140–1148, 1162), so this closes it the same way.
--
-- Ordered just before 1162 (designed rooms), because a reader of What's New should
-- meet the room before they meet what it can now become. `new`, not `improvement`:
-- holding a standup inside the board was not possible before the surface existed.
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
    'a1b2c301-0009-4000-8000-000000000015',
    '2026.9.28',
    'Stand up inside your board: the Room',
    'A standup is about the work in front of you, and it used to happen somewhere else — on a call, with somebody sharing the board everyone had just left. Press Room on any canvas and the session becomes a room: everyone in it standing round a table, lit when they are in the room and dimmed when they are still on the board, with the session itself laid out on the table and its newest creations standing round the walls with the real picture each one produced. Drag the session or a creation to move it; open either from where it stands. Every creation that lives in 3D lands in the room as it is made, and Brain takes you there to see it. It works for a workshop at Idea, the daily standup at Make and the retrospective at Measure — and it needs no setup: one person in the room is simply a room ten seconds before the second person arrives.',
    'new',
    'live',
    '2026-09-12 22:25:00'
  )
ON CONFLICT (id) DO NOTHING;
