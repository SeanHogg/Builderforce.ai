-- 0333_run_outcome_literal_signals.sql
-- Literal tool-use + human-review signals on run_model_outcomes (Residual 3).
--
-- Trait reinforcement (proposeTraitReinforcement) reads a run's tool-error rate and
-- human-rejection flag to decide how to nudge an agent's personality. Until now
-- `outcomeToSignal` derived those from PROXIES — a `degraded` run stood in for "tool
-- errors were high" and a `cancelled` run stood in for "a human rejected it" — because
-- the literal counts were never persisted at scoring time.
--
-- These three additive columns let the scorer (scoreRunOutcome / recordClientRunOutcome)
-- record the REAL telemetry it already has access to at terminal time:
--
--   • tool_calls    — total tool calls the run made (category='tool' audit events)
--   • tool_errors   — how many of those returned an error (`ok:false`)
--   • human_rejected — a human rejected the work: a bubbled-up approval was rejected,
--                      OR the pull request was closed without merging
--
-- toolErrorRate then reads as tool_errors / max(1, tool_calls); humanRejected reads the
-- real flag; humanAccepted stays `merged` (a merged PR).
--
-- NULLABLE with NO default ON PURPOSE: existing rows (scored before this migration) stay
-- NULL, and `outcomeToSignal` falls back to the old degraded/cancelled proxy for THOSE
-- rows alone. Every row scored after this ships carries literal values (0 is a real
-- datum, distinct from NULL). Additive + idempotent (ADD COLUMN IF NOT EXISTS),
-- following 0283/0324.

ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS tool_calls     INTEGER,
  ADD COLUMN IF NOT EXISTS tool_errors    INTEGER,
  ADD COLUMN IF NOT EXISTS human_rejected BOOLEAN;
