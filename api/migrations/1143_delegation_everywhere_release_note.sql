-- 1143 · Release note for sub-agent delegation on every surface, and children that write.
--
-- `new`, not `fix`. Delegation existed on two surfaces of four, and the child could only
-- ever read. Both halves change here: an agent running in the Cloudflare Container or on
-- a GitHub Actions runner can now commission a sub-agent, and a sub-agent in the editor
-- can make the change it was sent to make instead of only describing it. Neither is a
-- repaired regression — they are things nobody could do in Builderforce.ai before.
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
    'a1b2c301-0009-4000-8000-000000000009',
    '2026.9.16',
    'Sub-agents everywhere — and they can write the code now',
    'An agent could already hand a side quest to a sub-agent: a bounded question, answered in its own context, so the main run stays on the work instead of drowning in what it had to read to get there. It just could not do it in the two places it was worth the most. A long-lived run in a container or on a GitHub Actions runner — the ones with a real shell, a real checkout and the time to use them — had no way to delegate, so every search happened inline and every file it opened stayed in the transcript. Both of those surfaces can now spawn a sub-agent, on the same budget and the same terms as everywhere else, and the child''s work is metered and attributed to your workspace exactly like the run that commissioned it. The second half is the editor. A sub-agent on your own machine used to be read-only, because a delegated run had no way to reach the approval prompt — so it could tell you which fourteen files needed the same change and then hand them all back for you to edit. Now it can make the edit. Every write a sub-agent makes asks you first, naming the file, on the same prompt your agent''s own writes use and under the same governance gates; Auto covers them like anything else, a blocked tool stays blocked, and a decline comes back to the sub-agent as something to work around rather than a dead end. Delegation still defaults to read-only, because most of it is investigation — an agent has to ask for a writable child, and you still say yes.',
    'new',
    'live',
    '2026-09-07 16:10:00'
  )
ON CONFLICT (id) DO NOTHING;
