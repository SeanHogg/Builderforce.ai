-- 1211 · Release note: watch what visitors do — session replay & heatmaps.
--
-- `new`: analytics could tell you that people left, not why. Session replay plays
-- the visit the visitor saw — page, cursor, the click that went nowhere — tagged
-- with the release it ran on. Heatmaps compare click, scroll and attention by
-- release, not by URL. Recordings of the people who did not convert grade a
-- proof's kill condition (sample reached, success event fired). Inputs stay
-- masked; API keys stay blocked. Install Insights, drop a snippet, or turn
-- recording on for a hosted app. Shipped in frontend 2026.10.42.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001211',
    '2026.10.42',
    'Watch what visitors do — session replay & heatmaps',
    'Analytics could tell you that people left. They could not tell you why. You can now watch a visit the way the visitor saw it — the page, the cursor, the click that went nowhere — tagged with the release they were on. Heatmaps show where people click, scroll and stall, compared release against release so last week''s broken heading cannot hide inside this week''s map. Recordings of the people who did not convert are what grade a proof: a sample that was actually reached, a success event they actually triggered, and the visit you can seek to the rage click. A moment becomes a ticket; the next release tells you whether the fix worked. Inputs stay masked. API keys stay blocked. Install Insights, drop a snippet on your site, or turn recording on for a hosted app — the first visit lands within seconds.',
    'new',
    'live',
    '2026-10-11 22:00:00'
  )
ON CONFLICT (id) DO NOTHING;
