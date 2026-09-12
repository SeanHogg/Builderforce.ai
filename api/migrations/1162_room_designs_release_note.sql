-- 1162 · Release note for designed rooms, Roblox-style walking, and Roblox places
-- played inside the room.
--
-- `new`, not `improvement`. Three things a person could not do before this pass:
-- choose or design the room a session meets in (a boardroom, an office kitchen,
-- cubicles on an open floor, or their own arrangement of furniture), share that
-- design in the marketplace as a `room` listing, and walk the room — WASD, jump,
-- third-person camera — with a generated Roblox place playable inside the same
-- surface rather than in a separate one. None of it is a repaired regression.
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
    'a1b2c301-0009-4000-8000-000000000012',
    '2026.9.28',
    'Design the room you meet in, walk it like a game, and play your Roblox place inside it',
    'The room used to be one room: a round table, a ring of chairs, a back wall. It is now yours to design. Press Design in the room and pick where this session meets — a boardroom with a long table and a screen on the wall, an office kitchen with an island and stools, cubicles on an open floor — or start from any of them and drag desks, sofas, partitions, plants and whiteboards into a room of your own. Chairs seat the roster: the first person on the session takes the first chair you placed. A room design is an object on your board like everything else, so Brain can change it in a sentence ("make the room a kitchen"), and it goes on the marketplace as a Room listing that another session installs and meets in. Then walk it. Press Walk and the room becomes a place you move through the way you would in Roblox — WASD or arrows to move, Space to jump, right-drag or a finger to look, V to switch between first and third person, an on-screen pad on a phone — with every wall and every piece of furniture solid, and everyone else in the session standing where they really are. Roblox runs inside the room now too: a Roblox place your canvas generated stands on its plinth, and pressing Play drops you into its level right there, in the same surface with the same walker, scored by the level''s own collectibles, hazards and goal, with one button back to the room. Everything is in the room; nothing leaves it.',
    'new',
    'live',
    '2026-09-12 22:30:00'
  )
ON CONFLICT (id) DO NOTHING;
