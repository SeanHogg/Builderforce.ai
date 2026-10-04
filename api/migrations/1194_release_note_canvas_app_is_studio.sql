-- 1194 · Release note: the canvas App tab runs the full Studio workspace.
--
-- `new`: before this, App on the canvas could only preview the board's code cards as one
-- stitched page — no server, no packages, no database. It now opens the real Studio
-- workspace in place (files, in-browser runtime, terminal, database, publishing), the
-- canvas Brain can edit the app's files, code cards are brought into the app on open,
-- and a board with no account runs its app in the browser until "Keep your work".
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001194',
    '2026.10.5',
    'Press App on any canvas to build a real project',
    'The App tab on the canvas now opens the full Studio workspace right where you are. You get real files, a runtime that installs packages and can run a server, a terminal, a database and publishing. Brain on the canvas can edit your app''s code directly, so asking for a change updates the running app. Code cards already on your board are brought into the app automatically. You can start without an account: the app runs in your browser, and Keep your work saves it to an account with history, a database and a live address. If a board holds more than one app, switch between them from the session bar, or open any of them full-screen in Studio.',
    'new',
    'live',
    '2026-10-04 20:00:00'
  )
ON CONFLICT (id) DO NOTHING;
