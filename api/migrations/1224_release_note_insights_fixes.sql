-- 1224 · Release note: Insights tells you what to fix — and proves it worked.
--
-- `new`: recordings and heatmaps showed the problem and left the next step to
-- you. Insights now leads with ranked fixes: a finding from what visitors did
-- (or a measured fact from the per-release page review), an impact range from
-- the site's own visitors, the change rendered before/after on the page, and one
-- way to make it — a preview release a person publishes, an A/B test with a
-- stopping rule, a follow-up through the workspace's sales rules, a ticket, or a
-- prompt for the composer, a coding agent or a site builder. The next release is
-- detected and the fix graded worked / no effect / worse, with a revert on worse.
-- Shipped in frontend 2026.10.48.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001224',
    '2026.10.48',
    'Insights tells you what to fix — and proves it worked',
    'Watching a visit told you what went wrong. It did not tell you what to change, what the change was worth, or whether the change you shipped did anything. Insights now opens on a short list of fixes, ranked by likely impact against effort. Each one starts from something your visitors actually did — the element they rage-clicked, the error behind a drop-off, the button below where most people stop scrolling — or from a review of your key pages on every release: desktop and phone screenshots, search basics, content, speed and accessibility. Each comes with an impact range worked out from your own visitors, and says so plainly when there are too few visits to tell. You see the change drawn on your page, before and after. Then you choose how it gets made: on a site hosted with us, a preview release you publish; or an A/B test that stops on a rule you set up front, a follow-up to known visitors through your own sales rules, a ticket, or a ready-to-use prompt for the canvas, a coding agent or your site builder. Nothing goes live on its own. When the next release arrives it is picked up automatically, the page is checked again, and the fix gets a verdict — worked, no effect, or worse, with a way to revert it if it made things worse.',
    'new',
    'live',
    '2026-10-13 22:00:00'
  )
ON CONFLICT (id) DO NOTHING;
