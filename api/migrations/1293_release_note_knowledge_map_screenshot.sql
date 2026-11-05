-- 1293 · Release note: paste a screenshot, find the code behind it — the knowledge map.
--
-- `new`: PRD 38 "The visualizer, Option B+". One surface shows a codebase as a transit map
-- (lines from entry points through layers to stores and external services), with questions
-- instead of lenses, eight views, metric-to-channel overlays, Sync / Coverage / Patterns / API /
-- Fix queue / Simulate panels, and pasting a screenshot into the ask bar filters the view to
-- the code behind it (vision reads the text, deterministic search maps it through the i18n
-- catalogs and source, each match labelled exact / catalog / import, then Diagnose with the
-- agent). Blog: /blog/paste-a-screenshot-find-the-code.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay, `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
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
    'a1b2c301-0011-4000-8000-000000001293',
    '2026.10.130',
    'Paste a screenshot, find the code behind it',
    'You can see a problem on screen and still not know where it lives in the code. Paste the screenshot into the knowledge view and it narrows your codebase to the files behind what is showing. A vision model reads the visible text, search maps it through your translation catalogs and source to files and one import further, and every match says how it was found: exact, catalog or import. Then Diagnose with the agent hands over the path and its findings. The view itself is now a map: lines run from each entry point through the layers to your stores and outside services, instead of a graph of thousands of dots. Ask Where does it go, What is wrong, What has no test or What changed, and switch between Map, System, Graph, Mind map, Tower 3D, Heat, List and Sequence views. Overlays let anti-patterns, complexity, coverage, usage, churn, changes or owner drive colour, size, ring, line width or pulse. Panels cover sync status, coverage, patterns, an OpenAPI or Postman export of your routes, a fix queue for unused code, and simulating a path with values you choose.',
    'new',
    'live',
    '2026-11-05 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
