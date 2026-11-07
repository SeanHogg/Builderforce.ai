-- 1303 · Release note: a folder of many systems reads as many systems.
--
-- `new`: PRD 41 A9. Reviewing a folder that holds many systems (a monorepo or a workspace of many
-- repos) shows each system as its own system, groups lines by system, has no file-count cap, and
-- detects stray copies (vendored or duplicated trees) with a one-click Exclude action.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0012-4000-8000-000000001303',
    '2026.10.140',
    'One folder, many systems — each one on its own map, and the stray copies called out',
    'Point a review at a folder that holds many systems, a monorepo or a workspace of many repos, and it used to read as one tangled system, with stray copies of the same code counted again and again. Now every system in the folder is its own system on the map: lines are grouped by system, named after the system and its package, and each line says where it stops instead of a bare "ends here". There is no longer a cap on how many files are read, so a big folder is mapped end to end. When the same project turns up twice, say a vendored or duplicated tree, the review flags the stray copy, explains why it looks like one, and offers an Exclude from review button. One click adds it to your ignore list and starts a normal re-review with the usual estimate and confirm, so the map shows only the real code. Nothing is changed in your folder behind your back.',
    'new',
    'live',
    '2026-11-07 14:00:00'
  )
ON CONFLICT (id) DO NOTHING;
