-- 1297 · Release note: the knowledge map works offline, and a folder review is a run you can watch.
--
-- `new`: PRD 41 A7 + A8. The map is drawn from the copy on your machine, linked or not, and the
-- server is only a replica kept in sync in the background. Review / Re-review a folder opens a
-- Run panel (phases, worker lanes, steps, failures with Retry, the last 20 runs per folder), and
-- the work itself runs in parallel under one shared limit on model calls.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0012-4000-8000-000000001297',
    '2026.10.139',
    'Watch your codebase review run — and keep your map when the server is gone',
    'Reviewing a folder used to be a spinner you could not see into, and the knowledge map vanished whenever the server did. Now the map opens from the copy on your own computer, whether or not the workspace is linked, and the server is just a replica that quietly catches up in the background, through a sign-out, a rate limit or a crash. A folder the server has but this machine does not is still drawn, read-only. Review and Re-review now open a Run panel called Run details: a timeline of the phases, lanes showing which files each worker is on, the list of steps, and any failures with a Retry button. Retry marks the failed files as owed and takes them through the normal plan, estimate and confirm, so nothing spends without your say. Every folder keeps its last 20 runs, and a run cut short by a crash is marked interrupted instead of disappearing. The work is also faster: reading files spreads across several threads on your machine, and judging runs four files at a time under one shared limit on model calls that eases off when a provider pushes back, so more speed never means more load on your provider. The results are identical to a one-file-at-a-time run.',
    'new',
    'live',
    '2026-11-07 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
