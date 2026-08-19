-- 0932 - Benchmark cohorts beyond software_saas (ROADMAP AIIMP-4).
--
-- 0230 shipped the Industry Benchmarking lens with ONE seeded cohort. Everything
-- above it was cohort-aware - the profile table, the picker, the percentile
-- ranking - but `BENCHMARK_INDUSTRIES` held a single entry, so a fintech, an
-- agency and an enterprise IT group were all told how they compared against SaaS
-- norms, and told it as a percentile with a rating attached. A benchmark against
-- the wrong cohort is not a weaker benchmark; it is a confident wrong answer, and
-- the surface gave the reader no way to see which they had.
--
-- ── WHERE THESE NUMBERS COME FROM ───────────────────────────────────────────
-- They are the 0230 software_saas anchors scaled per industry along the axes
-- those industries are KNOWN to differ on, and nothing finer. The point of the
-- scaling is direction and order of magnitude - a regulated fintech does not ship
-- at SaaS cadence and should not be graded as though it did - not a claim of
-- survey precision. `source` says so on every row, so a reader can weigh it.
--
--   fintech          release gates slow shipping; incident tolerance is low
--   ecommerce        high cadence, seasonal peaks, fast restore
--   healthtech       validation / clinical-safety review dominates lead time
--   agency_services  many small client codebases; high AI leverage, tight budgets
--   enterprise_it    change-advisory boards and release trains; long lead time
--
-- Percentage metrics are clamped to 100 after scaling, so no cohort can carry an
-- anchor a real tenant could never reach.
--
-- Idempotent: ON CONFLICT DO NOTHING against the (industry, size_band, metric)
-- unique key, so re-running never disturbs a cohort an operator has since tuned.

INSERT INTO industry_benchmarks
  (industry, size_band, metric, unit, p10, p25, p50, p75, p90, higher_is_better, source)
VALUES
  ('fintech', 'small', 'deploy_freq_per_week', '/wk', 0.28, 0.83, 2.2, 6.6, 19.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'deploy_freq_per_week', '/wk', 0.39, 1.1, 3.3, 9.9, 27.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'deploy_freq_per_week', '/wk', 0.55, 1.65, 5.5, 16.5, 49.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'lead_time_hours', 'h', 268.8, 115.2, 57.6, 19.2, 3.2, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'lead_time_hours', 'h', 384, 153.6, 76.8, 25.6, 6.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'lead_time_hours', 'h', 537.6, 230.4, 115.2, 38.4, 9.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'change_failure_rate_pct', '%', 24.5, 15.4, 10.5, 5.6, 2.1, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'change_failure_rate_pct', '%', 26.6, 17.5, 11.2, 6.3, 2.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'change_failure_rate_pct', '%', 28, 19.6, 12.6, 7, 3.5, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'mttr_hours', 'h', 50.4, 16.8, 5.6, 1.4, 0.35, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'mttr_hours', 'h', 67.2, 25.2, 8.4, 2.8, 0.7, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'mttr_hours', 'h', 84, 33.6, 12.6, 4.2, 1.05, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'ai_merge_rate_pct', '%', 17, 29.75, 42.5, 55.25, 68, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'ai_merge_rate_pct', '%', 18.7, 32.3, 44.2, 57.8, 69.7, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'ai_merge_rate_pct', '%', 21.25, 34, 46.75, 59.5, 72.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'cost_per_merged_pr_usd', '$', 31.25, 15, 7.5, 3.12, 1.25, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'cost_per_merged_pr_usd', '$', 37.5, 18.75, 8.75, 3.75, 1.5, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'cost_per_merged_pr_usd', '$', 50, 25, 11.25, 5, 1.88, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'small', 'ai_adoption_pct', '%', 8.5, 21.25, 38.25, 55.25, 72.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'mid', 'ai_adoption_pct', '%', 10.2, 23.8, 40.8, 57.8, 74.8, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('fintech', 'large', 'ai_adoption_pct', '%', 12.75, 25.5, 42.5, 59.5, 76.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'deploy_freq_per_week', '/wk', 0.62, 1.88, 5, 15, 43.75, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'deploy_freq_per_week', '/wk', 0.88, 2.5, 7.5, 22.5, 62.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'deploy_freq_per_week', '/wk', 1.25, 3.75, 12.5, 37.5, 112.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'lead_time_hours', 'h', 142.8, 61.2, 30.6, 10.2, 1.7, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'lead_time_hours', 'h', 204, 81.6, 40.8, 13.6, 3.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'lead_time_hours', 'h', 285.6, 122.4, 61.2, 20.4, 5.1, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'change_failure_rate_pct', '%', 40.25, 25.3, 17.25, 9.2, 3.45, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'change_failure_rate_pct', '%', 43.7, 28.75, 18.4, 10.35, 4.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'change_failure_rate_pct', '%', 46, 32.2, 20.7, 11.5, 5.75, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'mttr_hours', 'h', 57.6, 19.2, 6.4, 1.6, 0.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'mttr_hours', 'h', 76.8, 28.8, 9.6, 3.2, 0.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'mttr_hours', 'h', 96, 38.4, 14.4, 4.8, 1.2, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'ai_merge_rate_pct', '%', 20, 35, 50, 65, 80, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'ai_merge_rate_pct', '%', 22, 38, 52, 68, 82, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'ai_merge_rate_pct', '%', 25, 40, 55, 70, 85, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'cost_per_merged_pr_usd', '$', 23.75, 11.4, 5.7, 2.38, 0.95, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'cost_per_merged_pr_usd', '$', 28.5, 14.25, 6.65, 2.85, 1.14, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'cost_per_merged_pr_usd', '$', 38, 19, 8.55, 3.8, 1.42, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'small', 'ai_adoption_pct', '%', 10, 25, 45, 65, 85, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'mid', 'ai_adoption_pct', '%', 12, 28, 48, 68, 88, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('ecommerce', 'large', 'ai_adoption_pct', '%', 15, 30, 50, 70, 90, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'deploy_freq_per_week', '/wk', 0.23, 0.68, 1.8, 5.4, 15.75, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'deploy_freq_per_week', '/wk', 0.32, 0.9, 2.7, 8.1, 22.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'deploy_freq_per_week', '/wk', 0.45, 1.35, 4.5, 13.5, 40.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'lead_time_hours', 'h', 319.2, 136.8, 68.4, 22.8, 3.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'lead_time_hours', 'h', 456, 182.4, 91.2, 30.4, 7.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'lead_time_hours', 'h', 638.4, 273.6, 136.8, 45.6, 11.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'change_failure_rate_pct', '%', 22.75, 14.3, 9.75, 5.2, 1.95, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'change_failure_rate_pct', '%', 24.7, 16.25, 10.4, 5.85, 2.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'change_failure_rate_pct', '%', 26, 18.2, 11.7, 6.5, 3.25, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'mttr_hours', 'h', 61.2, 20.4, 6.8, 1.7, 0.42, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'mttr_hours', 'h', 81.6, 30.6, 10.2, 3.4, 0.85, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'mttr_hours', 'h', 102, 40.8, 15.3, 5.1, 1.27, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'ai_merge_rate_pct', '%', 14, 24.5, 35, 45.5, 56, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'ai_merge_rate_pct', '%', 15.4, 26.6, 36.4, 47.6, 57.4, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'ai_merge_rate_pct', '%', 17.5, 28, 38.5, 49, 59.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'cost_per_merged_pr_usd', '$', 33.75, 16.2, 8.1, 3.38, 1.35, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'cost_per_merged_pr_usd', '$', 40.5, 20.25, 9.45, 4.05, 1.62, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'cost_per_merged_pr_usd', '$', 54, 27, 12.15, 5.4, 2.03, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'small', 'ai_adoption_pct', '%', 7, 17.5, 31.5, 45.5, 59.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'mid', 'ai_adoption_pct', '%', 8.4, 19.6, 33.6, 47.6, 61.6, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('healthtech', 'large', 'ai_adoption_pct', '%', 10.5, 21, 35, 49, 63, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'deploy_freq_per_week', '/wk', 0.42, 1.27, 3.4, 10.2, 29.75, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'deploy_freq_per_week', '/wk', 0.59, 1.7, 5.1, 15.3, 42.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'deploy_freq_per_week', '/wk', 0.85, 2.55, 8.5, 25.5, 76.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'lead_time_hours', 'h', 184.8, 79.2, 39.6, 13.2, 2.2, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'lead_time_hours', 'h', 264, 105.6, 52.8, 17.6, 4.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'lead_time_hours', 'h', 369.6, 158.4, 79.2, 26.4, 6.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'change_failure_rate_pct', '%', 42, 26.4, 18, 9.6, 3.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'change_failure_rate_pct', '%', 45.6, 30, 19.2, 10.8, 4.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'change_failure_rate_pct', '%', 48, 33.6, 21.6, 12, 6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'mttr_hours', 'h', 93.6, 31.2, 10.4, 2.6, 0.65, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'mttr_hours', 'h', 124.8, 46.8, 15.6, 5.2, 1.3, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'mttr_hours', 'h', 156, 62.4, 23.4, 7.8, 1.95, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'ai_merge_rate_pct', '%', 24, 42, 60, 78, 96, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'ai_merge_rate_pct', '%', 26.4, 45.6, 62.4, 81.6, 98.4, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'ai_merge_rate_pct', '%', 30, 48, 66, 84, 100, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'cost_per_merged_pr_usd', '$', 18.75, 9, 4.5, 1.88, 0.75, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'cost_per_merged_pr_usd', '$', 22.5, 11.25, 5.25, 2.25, 0.9, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'cost_per_merged_pr_usd', '$', 30, 15, 6.75, 3, 1.12, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'small', 'ai_adoption_pct', '%', 12, 30, 54, 78, 100, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'mid', 'ai_adoption_pct', '%', 14.4, 33.6, 57.6, 81.6, 100, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('agency_services', 'large', 'ai_adoption_pct', '%', 18, 36, 60, 84, 100, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'deploy_freq_per_week', '/wk', 0.17, 0.52, 1.4, 4.2, 12.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'deploy_freq_per_week', '/wk', 0.24, 0.7, 2.1, 6.3, 17.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'deploy_freq_per_week', '/wk', 0.35, 1.05, 3.5, 10.5, 31.5, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'lead_time_hours', 'h', 369.6, 158.4, 79.2, 26.4, 4.4, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'lead_time_hours', 'h', 528, 211.2, 105.6, 35.2, 8.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'lead_time_hours', 'h', 739.2, 316.8, 158.4, 52.8, 13.2, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'change_failure_rate_pct', '%', 31.5, 19.8, 13.5, 7.2, 2.7, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'change_failure_rate_pct', '%', 34.2, 22.5, 14.4, 8.1, 3.6, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'change_failure_rate_pct', '%', 36, 25.2, 16.2, 9, 4.5, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'mttr_hours', 'h', 90, 30, 10, 2.5, 0.62, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'mttr_hours', 'h', 120, 45, 15, 5, 1.25, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'mttr_hours', 'h', 150, 60, 22.5, 7.5, 1.88, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'ai_merge_rate_pct', '%', 13, 22.75, 32.5, 42.25, 52, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'ai_merge_rate_pct', '%', 14.3, 24.7, 33.8, 44.2, 53.3, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'ai_merge_rate_pct', '%', 16.25, 26, 35.75, 45.5, 55.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'cost_per_merged_pr_usd', '$', 37.5, 18, 9, 3.75, 1.5, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'cost_per_merged_pr_usd', '$', 45, 22.5, 10.5, 4.5, 1.8, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'cost_per_merged_pr_usd', '$', 60, 30, 13.5, 6, 2.25, FALSE, 'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'small', 'ai_adoption_pct', '%', 6.5, 16.25, 29.25, 42.25, 55.25, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'mid', 'ai_adoption_pct', '%', 7.8, 18.2, 31.2, 44.2, 57.2, TRUE,  'Scaled from DORA/SaaS norms per industry'),
  ('enterprise_it', 'large', 'ai_adoption_pct', '%', 9.75, 19.5, 32.5, 45.5, 58.5, TRUE,  'Scaled from DORA/SaaS norms per industry')
ON CONFLICT (industry, size_band, metric) DO NOTHING;
