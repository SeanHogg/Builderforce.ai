-- 1362 · Release note: eight more verticals get their own KPI tiles and milestone bars.
--
-- PRD 25 slice D (docs/specs/measure.md P25-06). `new`: fintech, digital health, MedTech,
-- BioTech, climate and energy, hardware and robotics, cybersecurity and marketplace presets
-- carry their vertical metric families and a StageBar for milestone KPIs (regulatory stage,
-- development stage, production stage, TRL). Honest limit stated in the copy: these verticals
-- have no benchmark cohort yet (P25-09), so tiles show values without a band.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0022-4000-8000-000000001362',
    '2026.11.153',
    'Your vertical''s KPI dashboard now tracks the milestones investors fund against',
    'The dashboards for FinTech, digital health, MedTech, BioTech, climate and energy, hardware and robotics, cybersecurity and marketplaces now carry the numbers each sector is judged by — TPV and take rate, engaged members, cost per clinical data point, tCO2e abated, BOM cost and backlog, pipeline coverage, GMV and liquidity — plus a stage bar for the milestone that moves your valuation: regulatory clearance, clinical phase, production run or technology readiness. Set the stage you are at and it sits beside your runway, so months-to-milestone and months-of-cash are on one screen. Benchmark bands for these sectors are not seeded yet, so the tiles show your values without a cohort rank until sourced data exists.',
    'new',
    'live',
    '2026-11-20 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
