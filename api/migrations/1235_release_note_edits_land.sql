-- 1235 · Release note: edits land while you watch — hot updates, real stylesheets, Next.js and SvelteKit.
--
-- `new`: the app preview (canvas App surface and Studio workspace) updates in place —
-- stylesheet edits swap without a reload and React component edits re-render keeping
-- their state (React Fast Refresh), falling back to a reload when an edit cannot apply
-- safely. Sass/SCSS/Less compile in the preview and in the published site (buildSite
-- passes the runtime's style compilers); CSS Modules are scoped for real; stylesheets
-- imported from npm packages load. Next.js (`next dev`) and SvelteKit (`vite dev` on
-- real Vite) run their own dev servers in the browser. The runtime is BuilderForce
-- WebContainers 2026.10.9. Shipped in the web app 2026.10.67.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001235',
    '2026.10.67',
    'Edits land while you watch: hot updates, real stylesheets, Next.js and SvelteKit',
    'Every reload used to cost you your place: the half-filled form, the open modal, the scroll position. The app you build on a canvas or in the Studio now updates in place as you edit. Change a CSS, SCSS or Less file and only that stylesheet is swapped in the running page. Edit a React component and it re-renders with the new code while keeping its state, using React''s own Fast Refresh. When an edit cannot be applied safely, the page reloads as before, so nothing is left half-updated. Real projects now reach the preview with their styles intact. Sass, SCSS and Less compile in the preview and in the site you publish, including partials, @use, @import and imports from npm packages. CSS Modules give every class a scoped name, with composes and :global. Stylesheets your packages ship, such as a component library''s theme, load instead of being skipped. And frameworks run as themselves: a Next.js project starts its own next dev server in the browser tab, and a SvelteKit project runs on real Vite, each rendering your pages with nothing of ours in between.',
    'new',
    'live',
    '2026-10-18 01:00:00'
  )
ON CONFLICT (id) DO NOTHING;
