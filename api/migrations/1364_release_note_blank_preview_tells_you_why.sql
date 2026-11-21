-- 1364 · Release note: a blank or slow in-browser preview now comes with a reason, and a Laravel
-- API starts in the browser tab.
--
-- `new`: BuilderForce WebContainers 2026.11.9, the open-source runtime behind browser Run and
-- the canvas preview. `runtime.diagnostics()` returns one load report (phase timings, package CDN
-- requests, requests per origin, slowest origins, recent CSP violations, cold/warm cache, and what
-- could not be measured); `runtime.onCspViolation` names the blocked origin and directive (no
-- paths); `previewCspMode: 'report-only'` for migrations (Builderforce never enables it); a custom
-- package `cdn` declares `origins`, which join the preview CSP. `php artisan serve` now runs, so a
-- Vite + Laravel + Postgres blueprint starts end to end in the tab, and setup-step logs (composer /
-- npm install) end with their last line before the next service changes state. `version` is the
-- runtime release. Blog: /blog/a-blank-preview-now-tells-you-why.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0023-4000-8000-000000001364',
    '2026.11.9',
    'A blank preview now tells you why, and a Laravel API comes up in the tab',
    'A preview that stays white, or takes twelve seconds to appear, used to leave you guessing: the network, the compiler, a package server or your own code. The in-browser runtime behind Run and the canvas preview now explains itself. When the preview''s security policy blocks something, such as map tiles from a third-party server or a font from a CDN, it names the origin and the rule that blocked it, without ever passing along the page''s paths. One load report times each phase of a preview starting up, counts the requests to each origin, lists the slowest, says whether the cache was cold or warm, and lists what it could not measure instead of showing a zero. Laravel apps now run too: php artisan serve used to fail in the browser, and now a Vite frontend, a Laravel API and Postgres start together in your tab, from composer install through the migrations to the first page. Setup steps such as composer install and npm install now finish their log with its last line before the next service starts, so the error you need is not cut off. For teams that embed the open-source runtime: a package mirror of your own joins the preview policy by declaring its origin, the .NET runtime bundle installs from npm, and the README lists every asset the runtime downloads and how to host it yourself.',
    'new',
    'live',
    '2026-11-21 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
