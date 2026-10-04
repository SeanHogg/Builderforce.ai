-- 1197 · Release note: Studio's Media panel — preview generated images and clips first.
--
-- `new`: before this, when the Studio agent generated a picture it wrote the link
-- straight into the app, and nothing listed what had been generated. The workspace
-- rail now has a Media tab (`components/builder/media/`). It shows what the agent
-- made and waits for Use it / Try again / Discard before anything reaches the code.
-- It also generates images and clips directly and keeps each project's media
-- library (`kernel.artifacts` rows hung off the project's registry object, served
-- at `/api/projects/:id/media`).
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001197',
    '2026.10.8',
    'Preview every image and clip before it goes in your app',
    'When Studio''s agent makes an image or a video clip for your app, it now shows it to you first. The Media panel opens beside your app with the new picture at full size and waits for you: use it, try again with a tweaked prompt, or discard it. Nothing goes into your code until you say so. You can also generate images and clips straight from the panel, and everything made for a project stays in its media library, ready to reuse, copy a link to, or hand to the agent with "Use in app".',
    'new',
    'live',
    '2026-10-04 21:00:00'
  )
ON CONFLICT (id) DO NOTHING;
