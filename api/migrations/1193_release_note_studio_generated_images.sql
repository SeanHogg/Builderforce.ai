-- 1193 · Release note: Studio generates the images in the apps it builds.
--
-- `new`: before this, the Studio agent had no way to make a picture. A hero image
-- or product shot came out as a placeholder service or a guessed stock-photo URL
-- that often 404'd. The workspace now has a `generate_image_asset` tool. It
-- generates the image, keeps it in the workspace's file storage, and returns a
-- permanent link that the agent writes into the code.
--
-- The free image vendors added to the gateway in the same pass (Cloudflare Workers
-- AI, Hugging Face, Pollinations, plus Gemini on paid plans) are plumbing, not news,
-- so they get no note of their own.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001193',
    '2026.10.5',
    'Studio makes the images your app needs',
    'Ask Studio for a landing page and you now get real pictures in it, not grey boxes or stock-photo links that turn out to be broken. When the agent needs a hero image, an illustration, a product shot or a background, it makes one to match your description, in a square, wide or tall shape. Each image is saved to your workspace with a permanent link, so it appears in the preview straight away and stays put after you publish. To change a picture, describe the change and the agent makes a new one. Images use your daily image credits, like images made on the canvas.',
    'new',
    'live',
    '2026-10-04 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
