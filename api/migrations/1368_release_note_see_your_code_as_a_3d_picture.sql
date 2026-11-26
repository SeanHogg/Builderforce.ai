-- 1368 · Release note: the knowledge view shows the code and a 3D picture of the system side by
-- side, at one shared location.
--
-- `new`: one location (system > component > class > method > line) drives both the code pane and
-- the 3D pane. Code lenses on classes and methods (go inside, out, callers, "No test · Simulate",
-- Restructure on anti-patterns). Flow and Sequence at every level with one 3D / Flat switch.
-- Before / After previews an anti-pattern's proposed restructure or a commit's changes on the map
-- and in the code. Blog: /blog/see-your-code-as-a-3d-picture.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Release notes have
-- one body column (no per-locale text), as in 1365/1366. Fixed id so the migration is safe to
-- replay; `emailed_at` left NULL so the product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0026-4000-8000-000000001368',
    '2026.11.26',
    'See your code as a 3D picture, with the code beside it',
    'Reading an existing system used to mean a file tree and an afternoon. Now the knowledge view shows the code and a 3D picture of the system side by side, at one shared location that runs from the system down through a component, a class and a method to a line. Move in either one and both move: click a shape and its code opens, click a class or method in the code and the picture drills in, and zoom into a shape to open it. Above each class and method sit code lenses: go inside, go out, see the callers, and where nothing covers a path, No test · Simulate, which runs it in the path simulator. On anti-patterns you also get Restructure. Flow and Sequence are available at every level, from the whole system to a single method, with one switch between 3D and Flat. Before / After lets you judge a change as a picture: pick an anti-pattern and watch the proposed restructure grow new modules out of the old file, or pick a commit from history and see what it changed on the map and in the code. Proposals are previews, and nothing changes until you apply one through the normal reviewed fix flow.',
    'new',
    'live',
    '2026-11-26 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
