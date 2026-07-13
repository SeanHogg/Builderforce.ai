-- 0230_industry_benchmarks.sql
-- Industry Benchmarking insights lens — let a tenant compare its key delivery
-- metrics (DORA four-keys, AI merge rate, cost-per-merged-PR, AI adoption) against
-- a seeded cohort distribution (percentiles p10..p90) for its industry + team-size
-- band. Two tables:
--
-- 1. industry_benchmarks — a SEEDED reference table of percentile values per
--    (industry, size_band, metric). The values below encode public-knowledge
--    DORA / SaaS engineering norms (DORA State-of-DevOps + common AI-adoption
--    reporting) so the lens can map a tenant's live value onto a percentile and a
--    rating (elite/high/medium/low) with zero per-tenant collection. `higher_is_better`
--    flips the percentile direction for metrics where lower is better (lead time,
--    change-failure rate, MTTR, cost-per-PR).
--
-- 2. tenant_benchmark_profiles — the tenant's chosen cohort (industry + size band).
--    One row per tenant (PK = tenant_id); a missing row defaults to software_saas/mid.
--
-- Idempotent / re-runnable: CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id               SERIAL PRIMARY KEY,
  industry         VARCHAR(48) NOT NULL,
  size_band        VARCHAR(16) NOT NULL,
  metric           VARCHAR(48) NOT NULL,
  unit             VARCHAR(16),
  p10              REAL,
  p25              REAL,
  p50              REAL,
  p75              REAL,
  p90              REAL,
  higher_is_better BOOLEAN NOT NULL DEFAULT TRUE,
  source           VARCHAR(120),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (industry, size_band, metric)
);

CREATE TABLE IF NOT EXISTS tenant_benchmark_profiles (
  tenant_id   INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  industry    VARCHAR(48) NOT NULL DEFAULT 'software_saas',
  size_band   VARCHAR(16) NOT NULL DEFAULT 'mid',
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Seed: software_saas across small | mid | large size bands ─────────────────
-- Percentiles run elite → low along the p10..p90 axis in the natural metric
-- direction; `higher_is_better=false` metrics (lead time, CFR, MTTR, cost) are
-- ranked so SMALLER values land at higher percentiles (handled in the service).
-- Values are realistic public-knowledge norms, scaled modestly by team size.

INSERT INTO industry_benchmarks
  (industry, size_band, metric, unit, p10, p25, p50, p75, p90, higher_is_better, source)
VALUES
  -- deploy_freq_per_week — deployments per week (higher better)
  ('software_saas', 'small', 'deploy_freq_per_week',   '/wk',  0.5,  1.5,   4,    12,   35,   TRUE,  'DORA State of DevOps (norms)'),
  ('software_saas', 'mid',   'deploy_freq_per_week',   '/wk',  0.7,  2,     6,    18,   50,   TRUE,  'DORA State of DevOps (norms)'),
  ('software_saas', 'large', 'deploy_freq_per_week',   '/wk',  1,    3,     10,   30,   90,   TRUE,  'DORA State of DevOps (norms)'),

  -- lead_time_hours — change lead time in hours (lower better)
  ('software_saas', 'small', 'lead_time_hours',        'h',    168,  72,    36,   12,   2,    FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'mid',   'lead_time_hours',        'h',    240,  96,    48,   16,   4,    FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'large', 'lead_time_hours',        'h',    336,  144,   72,   24,   6,    FALSE, 'DORA State of DevOps (norms)'),

  -- change_failure_rate_pct — % of deploys causing a failure (lower better)
  ('software_saas', 'small', 'change_failure_rate_pct','%',    35,   22,    15,   8,    3,    FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'mid',   'change_failure_rate_pct','%',    38,   25,    16,   9,    4,    FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'large', 'change_failure_rate_pct','%',    40,   28,    18,   10,   5,    FALSE, 'DORA State of DevOps (norms)'),

  -- mttr_hours — mean time to restore in hours (lower better)
  ('software_saas', 'small', 'mttr_hours',             'h',    72,   24,    8,    2,    0.5,  FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'mid',   'mttr_hours',             'h',    96,   36,    12,   4,    1,    FALSE, 'DORA State of DevOps (norms)'),
  ('software_saas', 'large', 'mttr_hours',             'h',    120,  48,    18,   6,    1.5,  FALSE, 'DORA State of DevOps (norms)'),

  -- ai_merge_rate_pct — % of AI runs that merge (higher better)
  ('software_saas', 'small', 'ai_merge_rate_pct',      '%',    20,   35,    50,   65,   80,   TRUE,  'AI engineering adoption (norms)'),
  ('software_saas', 'mid',   'ai_merge_rate_pct',      '%',    22,   38,    52,   68,   82,   TRUE,  'AI engineering adoption (norms)'),
  ('software_saas', 'large', 'ai_merge_rate_pct',      '%',    25,   40,    55,   70,   85,   TRUE,  'AI engineering adoption (norms)'),

  -- cost_per_merged_pr_usd — $ spend per merged PR (lower better)
  ('software_saas', 'small', 'cost_per_merged_pr_usd', '$',    25,   12,    6,    2.5,  1,    FALSE, 'AI engineering FinOps (norms)'),
  ('software_saas', 'mid',   'cost_per_merged_pr_usd', '$',    30,   15,    7,    3,    1.2,  FALSE, 'AI engineering FinOps (norms)'),
  ('software_saas', 'large', 'cost_per_merged_pr_usd', '$',    40,   20,    9,    4,    1.5,  FALSE, 'AI engineering FinOps (norms)'),

  -- ai_adoption_pct — % of delivered work touched by AI (higher better)
  ('software_saas', 'small', 'ai_adoption_pct',        '%',    10,   25,    45,   65,   85,   TRUE,  'AI engineering adoption (norms)'),
  ('software_saas', 'mid',   'ai_adoption_pct',        '%',    12,   28,    48,   68,   88,   TRUE,  'AI engineering adoption (norms)'),
  ('software_saas', 'large', 'ai_adoption_pct',        '%',    15,   30,    50,   70,   90,   TRUE,  'AI engineering adoption (norms)')
ON CONFLICT (industry, size_band, metric) DO NOTHING;
