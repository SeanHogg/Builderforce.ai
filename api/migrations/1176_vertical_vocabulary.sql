-- 1176 · One industry vocabulary: benchmark cohorts speak the startup sectors.
--
-- PRD 25 §6.4, operator-approved 2026-09-15. Two lists described the same fact:
-- `STARTUP_SECTORS` in the contract package (what a founder declares on the
-- listing — `saas`, `healthtech`, …) and `industry_benchmarks.industry` seeded by
-- 0230/0932 (`software_saas`, `enterprise_it`, `agency_services`, …). A company
-- listed as `saas` had no benchmark cohort without a manual second pick. The
-- listing sectors are now canonical; the seeded cohorts and every tenant's
-- profile are renamed onto them, and the profile default follows.
--
-- `agency_services` folds onto `other`: the sector list's escape hatch, and the
-- only honest home for a cohort the founder vocabulary never named.
-- `sustainability` on companies becomes `climate_energy`, the vertical's name in
-- the funding data the ten dashboard verticals were ranked from (PRD 25 §5).
--
-- Idempotent: each UPDATE matches nothing on replay; the DEFAULT is absolute.
-- No new table — the BurnRateOS cutover policy (newTablesAllowed: false) holds.

UPDATE industry_benchmarks
SET industry = CASE industry
  WHEN 'software_saas'   THEN 'saas'
  WHEN 'enterprise_it'   THEN 'enterprise_software'
  WHEN 'agency_services' THEN 'other'
  ELSE industry
END
WHERE industry IN ('software_saas', 'enterprise_it', 'agency_services');

UPDATE tenant_benchmark_profiles
SET industry = CASE industry
  WHEN 'software_saas'   THEN 'saas'
  WHEN 'enterprise_it'   THEN 'enterprise_software'
  WHEN 'agency_services' THEN 'other'
  ELSE industry
END,
updated_at = NOW()
WHERE industry IN ('software_saas', 'enterprise_it', 'agency_services');

ALTER TABLE tenant_benchmark_profiles ALTER COLUMN industry SET DEFAULT 'saas';

UPDATE companies
SET sector = 'climate_energy', updated_at = NOW()
WHERE sector = 'sustainability';
