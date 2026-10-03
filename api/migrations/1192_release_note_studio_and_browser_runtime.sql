-- 1192 · Release notes: Builderforce Studio, and Node apps running on the canvas.
--
-- Both `new`:
--   * Studio is a new destination (studio.builderforce.ai): prompt to a running app
--     with a pop-up sign-in, a version per agent turn you can restore, and a Database
--     view over the app's tables, sign-ins and server functions. None of the three
--     existed — versions, the Database view and the subdomain are new surfaces.
--   * The canvas can now run a project's own Node server (`npm install`, Express),
--     Vue and Svelte projects, and a real terminal, all in the browser on our own
--     runtime. Before, those projects either did not run or needed a metered
--     third-party session.
--
-- Fixed ids so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces each exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001192',
    '2026.10.4',
    'Builderforce Studio: describe an app, watch it run',
    'studio.builderforce.ai is a focused place to build an app from a prompt. Describe it, and the agent writes it while the preview runs beside the code. Signing in happens in a pop-up, so you never lose the page you were on. Every agent turn is saved as a version you can restore with two clicks (the current state is saved first, so a restore can be undone too), and you can name a version before a risky change. Search the whole project, switch between terminal, output and problems at the bottom, and use the new Database view next to Preview and Code: browse and prune your app''s tables, see who signed up and suspend or remove them, and manage server functions and their secrets. Publish, GitHub and Share are one click from the header.',
    'new',
    'live',
    '2026-10-03 22:00:00'
  ),
  (
    'a1b2c301-0009-4000-8000-000000001193',
    '2026.10.4',
    'Run Node, Vue and Svelte apps right on the canvas',
    'The canvas now runs far more kinds of project in your browser, with nothing to install. A project with its own Node server (an Express API, say) runs npm install and starts, and the preview shows its routes. Vue and Svelte projects preview and publish like React ones. The terminal is a real shell: run node, npm and the usual file commands. Publish builds your site in the browser, and Check type-checks it and reports errors to the agent so it can fix them. Everything a project runs is kept on a separate preview domain, away from your Builderforce session. Next.js, Nuxt and SvelteKit dev servers are not supported yet; Run tells you why instead of failing silently.',
    'new',
    'live',
    '2026-10-03 22:05:00'
  )
ON CONFLICT (id) DO NOTHING;
