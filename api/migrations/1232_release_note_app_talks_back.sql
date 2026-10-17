-- 1232 · Release note: your app now talks back — console, live connections, instant restore, download.
--
-- `new`: the app preview (canvas App surface and Studio workspace) gains a Console tab
-- fed by the runtime's own preview channel (every page the app serves, dev server and
-- Node server alike), and the Brain reads the same console through
-- `canvas_read_preview_console`. The runtime (BuilderForce WebContainers 2026.10.8) now
-- streams HTTP responses (Server-Sent Events, progress), carries WebSockets to the app's
-- own server, keeps the cookies a virtual server sets, runs shell scripts with
-- if/for/while/case/functions, and understands pnpm and yarn. Installed packages are kept
-- in the browser (IndexedDB) and restored on the next visit instead of reinstalling.
-- "Download project" zips the source from the Studio More menu and the canvas app panel bar.
-- Shipped in the web app 2026.10.61.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001232',
    '2026.10.61',
    'Your app now talks back: its console, live connections, instant restarts and a download button',
    'An app that runs in front of you but cannot tell you what it is doing is only half a preview. The app you build on a canvas or in the Studio now has a Console tab beside the terminal, showing everything it logs from every page it serves, filtered by level and with repeated lines counted. The Brain reads the same console, so you can ask why something is empty and it looks at what the app actually logged, not only whether it crashed. Live apps work in the preview too. Server-Sent Events and progress updates stream in as they are written, WebSockets connect to your app''s own server, and logins stay signed in because the cookies your server sets come back on every request. Shell scripts with if, for, while, case and functions run as written, and pnpm and yarn commands work next to npm. Coming back is faster: the packages a project installed are kept in your browser, so your next visit restores them in seconds instead of running npm install again. Change a dependency and it installs fresh, then keeps that. Finally, Download project, in the Studio More menu and the canvas app panel bar, gives you a zip of your app''s source to open in any editor or deploy anywhere.',
    'new',
    'live',
    '2026-10-17 23:00:00'
  )
ON CONFLICT (id) DO NOTHING;
