-- Publish the release note for shipping from the editor (commit / push / pull request).
--
-- The agent embedded in VS Code could change a working tree and had no verb for
-- moving that work anywhere: no commit, no push, no pull request. Its own persona
-- told it to reach for `run_command` and shell out git, which is how a one-line fix
-- ended up staged with `git add -A` — every file in a working tree shared with the
-- human sitting in front of it — and pushed straight to the base branch, unreviewed.
--
-- `git_commit` / `git_push` / `open_pull_request` close that, with the reviewed route
-- as the DEFAULT rather than the one you hope the agent picks. This is a `new` note,
-- not a `fix`: the capability did not exist on this surface before, on any path.
--
-- Fixed id so the migration is safe to replay, and `emailed_at` left NULL so the
-- product-updates digest announces it exactly once. `version` is the extension
-- release the tools are live in.
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
    'a1b2c301-0005-4000-8000-000000000001',
    '2026.9.12',
    'Ship from the editor: commit to a branch and open a pull request',
    'The agent in VS Code can now finish what it started. Ask it to ship a change and it commits to a ticket branch — naming the exact files it touched, so nothing else in your working tree is swept in — pushes that branch, and opens a pull request you can add reviewers to. Ask it to push straight to main and it offers the pull request instead; pushing the base branch is still available, but only as a separate act you approve, and the prompt now says plainly that it skips review. Every git tool also works when your open folder holds several checkouts rather than being one repository.',
    'new',
    'live',
    '2026-09-05 23:30:00'
  )
ON CONFLICT (id) DO NOTHING;
