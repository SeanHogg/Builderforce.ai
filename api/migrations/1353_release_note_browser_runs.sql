-- 1353 · Release note: a project's full-stack app now runs entirely in the browser tab.
--
-- `new`: PRD 31 §W9 phase 5. The AppBlueprint's services (frontend, API, Postgres) boot in the
-- tab on the browser run target, Node, Python and PHP services with Postgres as PGlite, wired
-- over virtual TCP, with the live preview beside the board. The same runtime.* tools (logs,
-- restart, preview capture) work for the Brain whether the run is in the browser or a container.
-- Containers remain the place for executions and deploys.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0018-4000-8000-000000001353',
    '2026.11.151',
    'Run your whole full-stack app in the browser tab',
    'A page, an API and a database used to need a cloud container before you could see them work together. Now Run starts all three inside your browser tab. The Node, Python and PHP services in your app blueprint (FastAPI, Flask, Django, Laravel, Slim) run in the tab, the database is a real Postgres running in the page, they are wired to each other, and the live preview opens beside your board. There is no container to boot or provision and it uses no cloud compute: installs (npm, pip, composer) run in the tab, and the first Run boots the in-tab runtime. Your app''s code, data and requests stay in your tab; packages download from their registries. The Brain works the same way it does on a container: it reads the logs, restarts a service and captures the preview, so you can ask why a page fails and watch it find and fix the cause. Containers are still there for executions and deploys, when the app is ready to leave the tab.',
    'new',
    'live',
    '2026-11-18 10:00:00'
  )
ON CONFLICT (id) DO NOTHING;
