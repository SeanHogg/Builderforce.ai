-- 1139 · Release note for the canvas-sharing fix (migration 1138).
--
-- `fix`, not `new`. Sharing a canvas was advertised on Free and Pro — three
-- collaborators and twenty-five — and simply did not work: the invitee's
-- workspace membership was billed as a paid seat the plan had already spent on
-- the owner, so accepting the invitation answered "the invited workspace cannot
-- add another member yet" every time. Making something work as claimed is not
-- news, and writing it up as news would be a lie about what changed.
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
    'a1b2c301-0006-4000-8000-000000000006',
    '2026.9.14',
    'Canvas invitations can be accepted on Free and Pro',
    'Inviting someone to a canvas sent the mail, and then the link refused them: accepting it reported that the workspace could not add another member. Their membership was being counted as a paid workspace seat, and Free and Pro each include one — already taken by the owner — so a plan that includes three and twenty-five canvas collaborators could share a board with nobody. A canvas guest is now counted as a collaborator against the collaborator limit, which is the number the plan actually advertises, and their workspace access is capped by the role you gave them on the board: someone invited to view or comment can no longer edit the rest of the workspace. The invite link also survives a second click — opening it again after you have joined takes you to the canvas instead of reporting an expired invitation.',
    'fix',
    'live',
    '2026-09-07 12:25:00'
  )
ON CONFLICT (id) DO NOTHING;
