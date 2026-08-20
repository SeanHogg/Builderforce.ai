-- 1083 — Record WHY a scheduled manager sweep did or did not reach a project.
--
-- ── THE AMBIGUITY ───────────────────────────────────────────────────────────
-- `project_manager_configs.last_run_at` is the only thing the overview has to go
-- on, and a stale value means any of FOUR mutually-exclusive things:
--   • the KV work-gate (`cronWorkSignal.ts`) decided there was no work to do,
--   • the tenant token gate skipped the whole tenant,
--   • the tick's dispatch budget was already spent by the autonomous executor,
--   • the cron itself never ran, or every pass died before stamping.
-- From the payload they are indistinguishable, so the diagnostics report could only
-- name the SYMPTOM (`last_run_stale`) and never the cause. "The cron is not reaching
-- this project" was an inference, not an answer.
--
-- ── THE RECORD ──────────────────────────────────────────────────────────────
-- Three columns beside `last_run_at`, written on EVERY sweep visit — including the
-- ones that decline — so the absence of a run is itself recorded:
--   last_sweep_decision : 'ran' | 'skipped'
--   last_sweep_reason   : null when it ran; otherwise the machine-readable cause
--                         ('tenant_token_limit' | 'tick_budget_exhausted' |
--                          'project_unmanaged' | 'pass_error')
--   last_sweep_at       : when that decision was made
--
-- Deliberately on the config row rather than in a new table: it is a SINGLE
-- CURRENT-STATE fact per project ("what happened last time"), it belongs next to
-- `last_run_at` which answers the adjacent question, and a per-visit history table
-- would grow one row per project per five minutes forever to answer a question
-- nobody asks about the past. The pass HISTORY has its own home — `manager_runs`
-- (migration 1082) — and that is where a trend over time is read from.

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS last_sweep_decision VARCHAR(16),
  ADD COLUMN IF NOT EXISTS last_sweep_reason   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_sweep_at       TIMESTAMP;
