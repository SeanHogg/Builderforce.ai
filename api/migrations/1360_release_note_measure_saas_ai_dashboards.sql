-- 1360 · Release note: the SaaS and AI-native KPI dashboards show real growth economics.
--
-- PRD 25 slice B (docs/specs/measure.md P25-02..P25-08). `new`: the SaaS and AI-native
-- presets now carry NRR, GRR, gross margin, CAC payback, LTV:CAC (blended and per tranche),
-- magic number, burn multiple, logo churn and inference margin, each ranked against a
-- sourced cohort band (migration 1359). Honest limit stated in the copy: a metric with no
-- data reads Not measured, never zero.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0020-4000-8000-000000001360',
    '2026.11.153',
    'See NRR, CAC payback and LTV:CAC per tranche on your SaaS or AI dashboard',
    'Install the SaaS or AI-native dashboard from Marketplace → Assets → Templates and Finance → Dashboard now shows the numbers a growth-stage investor asks for first: net and gross revenue retention, gross margin, CAC payback, LTV:CAC, magic number, burn multiple and logo churn — and, for AI-native companies, gross margin after inference. LTV:CAC is split by plan, cohort, channel and segment, so you can see which pocket of customers actually pays back and which one is below 3:1. Every tile is ranked against a cited benchmark band for companies of your size. Enter a figure yourself or let your synced ledger fill it; a number with nothing behind it says NOT MEASURED instead of showing a zero.',
    'new',
    'live',
    '2026-11-20 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
