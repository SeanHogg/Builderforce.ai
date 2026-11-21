-- 1363 - Cybersecurity benchmark seeds (Measure PRD 25 §5.3 / §6.5, slice D, P25-09).
--
-- PRD 25 §6.5: "a seed row with no source is rejected" and "no band, no rows". A
-- single anchor cannot rank a value (`rankPercentile` needs >= 2), so a vertical is
-- seeded for a metric ONLY where §5.3 names two figures for it. Of the eight
-- verticals still without a cohort, only `cybersecurity` does, and only for two
-- metrics:
--
--   nrr_pct        §5.3 cybersecurity: "NRR 110%+ sticky"  -> p50 110
--                  §5.3 SaaS:          "~120 top decile"    -> p90 120
--   burn_multiple  §5.3 cybersecurity: "burn multiple <1.5" -> p50 1.5
--                  §5.3 SaaS:          "<1 great"           -> p90 1.0
--
-- burn_multiple is lower-is-better, so p90 (best) is the SMALLER value, matching the
-- 0932/1359 anchor convention. Only `mid` is seeded: the PRD gives no size split.
-- The other seven verticals (fintech, healthtech, medtech, biotech, climate_energy,
-- hardware_robotics, marketplace) have only dollar/stage figures or a single anchor
-- in §5.3, so they correctly get no rows and the lens keeps reporting
-- `cohortSeeded: false` for them.
--
-- Idempotent: ON CONFLICT DO NOTHING on (industry, size_band, metric). No new tables.

INSERT INTO industry_benchmarks
  (industry, size_band, metric, unit, p50, p90, higher_is_better, source)
VALUES
  ('cybersecurity', 'mid', 'nrr_pct',       '%', 110, 120, TRUE,  'Measure PRD 25 §5.3 (cybersecurity NRR 110%+; SaaS top decile ~120)'),
  ('cybersecurity', 'mid', 'burn_multiple', 'x', 1.5, 1.0, FALSE, 'Measure PRD 25 §5.3 (cybersecurity burn <1.5; SaaS great <1)')
ON CONFLICT (industry, size_band, metric) DO NOTHING;
