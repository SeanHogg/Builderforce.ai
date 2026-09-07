-- 1140 · Release note for canvas invite links + joining without an account.
--
-- `new`, not `fix`. This is a capability that did not exist: a signed-in owner could
-- only share a board by typing an address and mailing a one-time token, and the person
-- who received it had to sign in as that exact address before they could see anything.
-- Sending a link, and taking one without making an account, are both things nobody
-- could do in Builderforce.ai before this.
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
    'a1b2c301-0007-4000-8000-000000000007',
    '2026.9.15',
    'Share a canvas with a link — and join one without an account',
    'Sharing a canvas used to get worse the moment you signed up. A logged-out visitor could start a session, copy a link and send it to anyone; an owner with a saved board could only type an email address, and whoever received it had to sign in as that exact address before they saw a thing. Both halves are now the same: open the invite panel on any saved canvas and create a link that grants view, comment or edit access. Send it however you like. Whoever opens it is told what board it is and what they can do on it, and then gets a choice — sign in, create an account, or just type a name and join. Someone who joins by name is a real collaborator: their cursor, edits and comments are saved like anyone else''s, they cost the workspace nothing (a canvas collaborator has never been a paid seat), and they can create an account later and open the same link to bring their work across. A link carries view, comment or edit and nothing more — never the ability to run agents or hand the board away — and every link you have made is listed in the same panel with one button to revoke it.',
    'new',
    'live',
    '2026-09-07 15:40:00'
  )
ON CONFLICT (id) DO NOTHING;
