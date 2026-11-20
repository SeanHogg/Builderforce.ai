-- 1359 - Growth benchmark seeds for saas + ai_ml (Measure PRD 25 §5.3 / §6.5, slice B4).
--
-- 0230/0932 seeded only delivery (DORA / AI) metrics. The growth dashboards
-- (growth.nrr, growth.grr, ...) read declared values, but the Benchmarking lens had
-- no cohort distribution to rank them against, so a founder's NRR showed no
-- percentile. These rows seed the missing distributions for the two cohorts the
-- vertical presets ship: `saas` and `ai_ml`, across small / mid / large.
--
-- Anchor convention matches 0932: p10..p90 run from WORST (p10) to BEST (p90) in
-- the metric's own direction, so higher_is_better=FALSE rows list DESCENDING values
-- (payback, burn multiple and monthly logo churn - smaller is better).
--
-- Source anchors (PRD 25 §5.3): NRR >=100 healthy / ~120 top decile; GRR >=90;
-- gross margin 70-85 (ai_ml ~52 average, ~60 good); CAC payback <12 months elite,
-- 15-18 median; LTV:CAC 3-5; magic number >0.75; burn multiple <1 great; logo
-- churn <1%/month; ARR growth median ~26%. Size bands shift the spread, not the
-- direction: small companies grow faster and churn more, large ones retain better
-- and grow slower. These are published-survey-shaped seeds, not measured
-- cohort data; `source` names the report on every row.
--
-- Idempotent: ON CONFLICT DO NOTHING against the (industry, size_band, metric)
-- unique key, so re-running never disturbs a cohort an operator has since tuned.
-- No new tables.

INSERT INTO industry_benchmarks
  (industry, size_band, metric, unit, p10, p25, p50, p75, p90, higher_is_better, source)
VALUES
  -- ── saas · nrr_pct ───────────────────────────────────────────────────────
  ('saas', 'small', 'nrr_pct', '%', 84, 92, 100, 108, 118, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'mid',   'nrr_pct', '%', 88, 96, 103, 111, 120, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'large', 'nrr_pct', '%', 90, 98, 105, 113, 122, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  -- ── saas · grr_pct ───────────────────────────────────────────────────────
  ('saas', 'small', 'grr_pct', '%', 74, 81, 87, 91, 94, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'mid',   'grr_pct', '%', 79, 85, 90, 93, 96, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'large', 'grr_pct', '%', 82, 88, 92, 95, 97, TRUE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  -- ── saas · gross_margin_pct ──────────────────────────────────────────────
  ('saas', 'small', 'gross_margin_pct', '%', 58, 66, 72, 78, 83, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'mid',   'gross_margin_pct', '%', 62, 69, 75, 80, 85, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'large', 'gross_margin_pct', '%', 65, 72, 77, 82, 86, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  -- ── saas · cac_payback_months (lower is better: p10 worst .. p90 best) ───
  ('saas', 'small', 'cac_payback_months', 'months', 32, 24, 18, 13, 9,  FALSE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'mid',   'cac_payback_months', 'months', 30, 22, 17, 12, 9,  FALSE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'large', 'cac_payback_months', 'months', 28, 21, 15, 11, 8,  FALSE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  -- ── saas · ltv_cac_ratio ─────────────────────────────────────────────────
  ('saas', 'small', 'ltv_cac_ratio', 'x', 1.2, 2.0, 3.0, 4.2, 5.5, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'mid',   'ltv_cac_ratio', 'x', 1.5, 2.3, 3.2, 4.5, 6.0, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  ('saas', 'large', 'ltv_cac_ratio', 'x', 1.8, 2.6, 3.5, 4.8, 6.5, TRUE, 'Eagle Rock CFO SaaS benchmarks 2026 Q1'),
  -- ── saas · magic_number ──────────────────────────────────────────────────
  ('saas', 'small', 'magic_number', 'x', 0.20, 0.40, 0.65, 0.90, 1.25, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  ('saas', 'mid',   'magic_number', 'x', 0.25, 0.45, 0.75, 1.00, 1.30, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  ('saas', 'large', 'magic_number', 'x', 0.25, 0.45, 0.70, 0.95, 1.20, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  -- ── saas · burn_multiple (lower is better) ───────────────────────────────
  ('saas', 'small', 'burn_multiple', 'x', 4.0, 2.8, 1.8, 1.2, 0.7, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  ('saas', 'mid',   'burn_multiple', 'x', 3.5, 2.4, 1.6, 1.0, 0.6, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  ('saas', 'large', 'burn_multiple', 'x', 3.0, 2.0, 1.4, 0.9, 0.5, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  -- ── saas · logo_churn_pct_monthly (lower is better) ──────────────────────
  ('saas', 'small', 'logo_churn_pct_monthly', '%/mo', 4.0, 2.8, 1.8, 1.0, 0.5, FALSE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'mid',   'logo_churn_pct_monthly', '%/mo', 3.0, 2.0, 1.3, 0.8, 0.4, FALSE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  ('saas', 'large', 'logo_churn_pct_monthly', '%/mo', 2.2, 1.5, 1.0, 0.6, 0.3, FALSE, 'KeyBanc/Sapphire SaaS Survey 2025 Q4'),
  -- ── saas · arr_growth_pct (median ~26) ───────────────────────────────────
  ('saas', 'small', 'arr_growth_pct', '%', 8,  18, 35, 70, 130, TRUE, 'SaaS Capital growth benchmarks 2026 Q1'),
  ('saas', 'mid',   'arr_growth_pct', '%', 5,  14, 26, 48, 85,  TRUE, 'SaaS Capital growth benchmarks 2026 Q1'),
  ('saas', 'large', 'arr_growth_pct', '%', 2,  9,  18, 32, 55,  TRUE, 'SaaS Capital growth benchmarks 2026 Q1'),

  -- ── ai_ml · nrr_pct ──────────────────────────────────────────────────────
  ('ai_ml', 'small', 'nrr_pct', '%', 80, 90, 100, 112, 128, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'nrr_pct', '%', 85, 94, 103, 114, 125, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'nrr_pct', '%', 88, 96, 105, 115, 124, TRUE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · grr_pct ──────────────────────────────────────────────────────
  ('ai_ml', 'small', 'grr_pct', '%', 70, 78, 85, 90, 94, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'grr_pct', '%', 75, 82, 88, 92, 95, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'grr_pct', '%', 79, 85, 90, 93, 96, TRUE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · gross_margin_pct (~52 average, ~60 good) ─────────────────────
  ('ai_ml', 'small', 'gross_margin_pct', '%', 28, 38, 48, 56, 64, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'gross_margin_pct', '%', 33, 43, 52, 60, 68, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'gross_margin_pct', '%', 38, 47, 56, 64, 72, TRUE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · inference_margin_pct ─────────────────────────────────────────
  ('ai_ml', 'small', 'inference_margin_pct', '%', 25, 36, 46, 55, 64, TRUE, 'a16z AI infrastructure margins survey 2026 Q1'),
  ('ai_ml', 'mid',   'inference_margin_pct', '%', 30, 41, 50, 59, 68, TRUE, 'a16z AI infrastructure margins survey 2026 Q1'),
  ('ai_ml', 'large', 'inference_margin_pct', '%', 35, 45, 55, 63, 72, TRUE, 'a16z AI infrastructure margins survey 2026 Q1'),
  -- ── ai_ml · cac_payback_months (lower is better) ─────────────────────────
  ('ai_ml', 'small', 'cac_payback_months', 'months', 30, 22, 16, 11, 7, FALSE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'cac_payback_months', 'months', 28, 21, 15, 11, 8, FALSE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'cac_payback_months', 'months', 27, 20, 15, 11, 8, FALSE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · ltv_cac_ratio ────────────────────────────────────────────────
  ('ai_ml', 'small', 'ltv_cac_ratio', 'x', 1.0, 1.8, 2.8, 4.0, 5.5, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'ltv_cac_ratio', 'x', 1.3, 2.1, 3.0, 4.3, 5.8, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'ltv_cac_ratio', 'x', 1.6, 2.4, 3.3, 4.6, 6.2, TRUE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · magic_number ─────────────────────────────────────────────────
  ('ai_ml', 'small', 'magic_number', 'x', 0.25, 0.45, 0.75, 1.10, 1.50, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  ('ai_ml', 'mid',   'magic_number', 'x', 0.25, 0.45, 0.75, 1.05, 1.40, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  ('ai_ml', 'large', 'magic_number', 'x', 0.25, 0.45, 0.70, 0.95, 1.25, TRUE, 'Bessemer State of the Cloud 2025 Q4'),
  -- ── ai_ml · burn_multiple (lower is better) ──────────────────────────────
  ('ai_ml', 'small', 'burn_multiple', 'x', 4.5, 3.0, 2.0, 1.3, 0.8, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  ('ai_ml', 'mid',   'burn_multiple', 'x', 4.0, 2.7, 1.8, 1.1, 0.7, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  ('ai_ml', 'large', 'burn_multiple', 'x', 3.5, 2.3, 1.5, 1.0, 0.6, FALSE, 'David Sacks burn multiple / Craft Ventures 2025 Q4'),
  -- ── ai_ml · logo_churn_pct_monthly (lower is better) ─────────────────────
  ('ai_ml', 'small', 'logo_churn_pct_monthly', '%/mo', 5.0, 3.3, 2.0, 1.2, 0.6, FALSE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'logo_churn_pct_monthly', '%/mo', 3.5, 2.3, 1.5, 0.9, 0.5, FALSE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'logo_churn_pct_monthly', '%/mo', 2.5, 1.7, 1.1, 0.7, 0.3, FALSE, 'ICONIQ State of AI 2025 Q4'),
  -- ── ai_ml · arr_growth_pct ───────────────────────────────────────────────
  ('ai_ml', 'small', 'arr_growth_pct', '%', 15, 35, 70, 140, 280, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'mid',   'arr_growth_pct', '%', 8,  20, 40, 80,  150, TRUE, 'ICONIQ State of AI 2025 Q4'),
  ('ai_ml', 'large', 'arr_growth_pct', '%', 4,  12, 26, 50,  90,  TRUE, 'ICONIQ State of AI 2025 Q4')
ON CONFLICT (industry, size_band, metric) DO NOTHING;
