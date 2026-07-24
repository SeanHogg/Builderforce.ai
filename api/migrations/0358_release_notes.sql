-- Migration: platform release notes — the changelog we MARKET to users.
--
-- Deliberately NOT tenant-scoped. `changelog_entries` (mig 0206-era product
-- tracker) is each tenant's changelog for THEIR product; this table is
-- Builderforce's OWN feature announcements, shown to every user in the footer
-- "What's new" panel and mailed weekly by the product-updates digest cron.
--
-- Lifecycle of a row:
--   draft        published_at IS NULL — visible only in /admin authoring.
--   published    published_at set     — appears in the footer panel immediately.
--   emailed      emailed_at set       — the weekly digest included it. The digest
--                selects published AND NOT-yet-emailed rows, so each note is
--                marketed by email exactly once ("sent" flag), while the panel
--                keeps showing the full history.
--
-- Consent for the digest send itself lives in email_preferences
-- (product_updates category + unsubscribed_all) — this table carries only the
-- content and its sent-state, never per-recipient state.

CREATE TABLE IF NOT EXISTS release_notes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The app version the feature shipped in (frontend or api version string).
  version      VARCHAR(50)  NOT NULL,
  title        VARCHAR(255) NOT NULL,
  -- Benefit-framed marketing copy (plain text; blank lines = paragraphs).
  body         TEXT,
  -- 'new' | 'improvement' | 'fix' — drives the badge in the panel + email.
  category     VARCHAR(20)  NOT NULL DEFAULT 'improvement',
  published_at TIMESTAMP,
  emailed_at   TIMESTAMP,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- The two read shapes: the panel ("published, newest first") and the digest
-- ("published, not yet emailed"). One partial index serves both orderings.
CREATE INDEX IF NOT EXISTS idx_release_notes_published
  ON release_notes (published_at DESC)
  WHERE published_at IS NOT NULL;

-- Seed: the recently shipped features worth announcing, published immediately
-- and NOT yet emailed — the first weekly digest picks them up. Fixed ids make
-- the seed idempotent across re-runs.
INSERT INTO release_notes (id, version, title, body, category, published_at) VALUES
  ('a1b2c301-0001-4000-8000-000000000001', '2026.7.93', 'Turn one prompt into a running app',
   'Type what you want to build on the dashboard and Builderforce scaffolds a complete project — files, build setup and a live preview — in a single step. No blank-editor moment: you go from idea to something you can click in under a minute.',
   'new', NOW()),
  ('a1b2c301-0001-4000-8000-000000000002', '2026.7.90', 'Deploy and test in one motion',
   'Publishing a site now automatically registers it with the Agentic Tester, so your just-deployed app can be exercised end-to-end without any setup. Fresh apps with no usage history get a sensible crawl plan out of the box.',
   'improvement', NOW()),
  ('a1b2c301-0001-4000-8000-000000000003', '2026.7.85', 'Meet your team without leaving Builderforce',
   'Video and audio meetings are built in — schedule them against your Google or Microsoft calendar and jump into a call right from the workspace, with your human teammates and the context of your boards around you.',
   'new', NOW()),
  ('a1b2c301-0001-4000-8000-000000000004', '2026.7.80', 'Bring your own AI subscription',
   'Connect the AI accounts you already pay for — including Claude Pro/Max — and your agents run on them directly. You control which provider leads, and your existing subscription does the work instead of a second bill.',
   'improvement', NOW()),
  ('a1b2c301-0001-4000-8000-000000000005', '2026.7.75', 'Find talent, or get found',
   'The freelance marketplace is live: publish a for-hire profile with your skills, rate and availability, or search the talent pool and bring the right person straight onto your board — humans and agents on one roster.',
   'new', NOW()),
  ('a1b2c301-0001-4000-8000-000000000006', '2026.7.70', 'Plan the big picture with OKRs and portfolios',
   'Objectives, key results, initiatives and a dated planning spine now sit above your projects — see how every ticket rolls up to the outcome it serves, from a single Gantt-backed portfolio view.',
   'new', NOW()),
  ('a1b2c301-0001-4000-8000-000000000007', '2026.7.65', 'Builderforce in your language',
   'The entire product now speaks English, Chinese, Spanish, French and German — pick your language once in Settings and the app, and the emails we send you, follow it everywhere.',
   'improvement', NOW()),
  ('a1b2c301-0001-4000-8000-000000000008', '2026.7.60', 'A security agent watching your back',
   'Hire the built-in Security agent and it runs a weekly SOC 2-style audit over your most active repositories, filing access-restricted findings on your board so compliance work never piles up unseen.',
   'new', NOW())
ON CONFLICT (id) DO NOTHING;
