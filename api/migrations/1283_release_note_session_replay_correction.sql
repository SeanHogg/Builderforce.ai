-- 1283 · Release note correction: session replay & heatmaps (the 1211 note).
--
-- The 1211 body promised more than shipped (it described the proof-grading and
-- ticket loop as part of this release, and a setup path that was never the default).
-- This rewrites that ONE row to what PRD 33 §0.1/§1 says Insights does: recordings
-- with masking, heatmaps, frustration signals, funnels and segments, live visitors,
-- cited AI summaries and ranked fixes, installed free from the Marketplace with
-- 5,000 kept recordings a month.
--
-- Idempotent: an UPDATE by the fixed id sets the same body every time. 1224 is a
-- separate note (ranked fixes in depth) and is untouched. `emailed_at` and
-- `published_at` are not changed, so the digest does not announce it a second time.
UPDATE release_notes
SET body = 'Analytics could tell you that people left. It could not tell you why. Insights lets you watch a visit the way the visitor saw it — the page, the cursor, the click that went nowhere — tagged with the release they were on. Heatmaps show where people click, scroll and stall, compared release against release. Frustration signals (rage clicks, dead clicks, errors, quick backs) mark the recordings worth opening first. Funnels and saved segments show where people drop out and who they are, and you can see who is on your site right now. Short AI summaries of a recording or a segment cite the moments they are drawn from, and Insights ranks the fixes worth making. Inputs are masked in the browser, password and card fields are never captured, and Do Not Track and Global Privacy Control are honoured. Install Insights free from the Marketplace: 5,000 kept recordings a month, with prepaid packs above that.'
WHERE id = 'a1b2c301-0010-4000-8000-000000001211';
