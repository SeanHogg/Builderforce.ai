-- 1206 · Release note: publish a job posting to your connected job boards from the canvas.
--
-- `new`: FO-B4. A canvas `jobPosting` card now has a Distribute control (and Brain a
-- `canvas_distribute_job_posting` tool): pick connected boards (Greenhouse, Lever,
-- Ashby, Indeed, LinkedIn Jobs or the careers-site feed), publish, and see per board
-- whether it is live, with its link. A board counts as live only when it answered with
-- its own id for the posting (`job_posting_distributions`, migration 1205, read through
-- each connector manifest's new `response` mapping); anything else is shown as failed
-- with the board's reason. A board that already has the posting is not posted to
-- twice, and applicants are counted per board in the posting's sources.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001206',
    '2026.10.37',
    'Publish a job posting to your job boards, right from the canvas',
    'A job posting on the canvas can now go out to the job boards you have connected: Greenhouse, Lever, Ashby, Indeed, LinkedIn Jobs, or your own careers-site feed. Open the posting card, tick the boards, press Distribute, and the card shows each board as Live with a link to the posting, or as Failed with the reason the board gave. A board only shows as Live once it has confirmed the posting, so you never send candidates to a listing that is not there, and pressing Distribute again never posts the same job twice. Applicants are counted per board in the posting''s sources, so you can see which boards are bringing people in and which are quiet. You can also just ask Brain to post the role; it will check which boards are connected and ask you which to use first.',
    'new',
    'live',
    '2026-10-10 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
