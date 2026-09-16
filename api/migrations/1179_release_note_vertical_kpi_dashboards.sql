-- 1179 · Release note: install your vertical's KPI dashboard from the Marketplace.
--
-- PRD 25 slice A — the metric registry, the founder tiles, the eleven dashboard
-- presets and the finance dashboard tab. `new`: the finance hub had runway and
-- cashflow, but nothing that answered "which numbers is a company like mine
-- judged by?" A dashboard is a marketplace TEMPLATE here rather than eleven
-- hand-written screens, so a twelfth vertical is a data change.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once. `version` is the frontend
-- release the surfaces ship in.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001179',
    '2026.9.35',
    'Install your vertical''s KPI dashboard from the Marketplace',
    'Finance has a third tab: the dashboard your vertical actually runs on. Open Marketplace → Assets → Templates and install the one for your sector — AI/ML, SaaS, FinTech, digital health, MedTech, BioTech, climate and energy, hardware and robotics, cybersecurity or marketplaces — or start from the empty state on Finance → Dashboard, which already knows your sector and links straight to the right template. It asks one question, how big the company is, because a metric''s healthy range moves with headcount. The tiles then resolve against your own finance and equity data: runway, cash, net burn, cash-zero date, founder ownership, unallocated pool, cliffs due in 90 days, and where you sit against your cohort. A metric with nothing behind it says it is NOT MEASURED rather than showing a zero, so you can tell at a glance which of your numbers are real. Every sector without a cohort of its own gets the founder dashboard.',
    'new',
    'live',
    '2026-09-16 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
