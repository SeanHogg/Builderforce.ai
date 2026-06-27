-- 0222_run_eval_scores.sql
--
-- Layer 6 (Observability & Evaluation) — SEMANTIC evaluation of run quality.
--
-- The platform already scored runs on OUTCOME (merged / CI / cost / steps, see
-- run_model_outcomes + computeOutcomeScore). It did NOT score whether the answer
-- was GROUNDED and ON-TOPIC — the RAG-eval metrics every LLM-observability tool
-- now ships. These columns add that, on the same per-run row so the learned-routing
-- and drift surfaces read one table:
--
--   • faithfulness      — answer grounded in its context (1 = fully grounded)
--   • answer_relevance  — deliverable addresses the task asked
--   • hallucination_rate — share of the answer NOT grounded (0 = none)
--   • eval_method       — 'lexical' (inline, zero-cost) | 'llm' (judge, /api/eval)
--
-- All nullable: a run scored before the evaluator ran simply has NULLs. The drift
-- monitor (driftMonitor.ts) reads these over a baseline vs recent window per
-- (action_type, resolved_model) to flag quality regressions. Idempotent.

ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS faithfulness       REAL,
  ADD COLUMN IF NOT EXISTS answer_relevance   REAL,
  ADD COLUMN IF NOT EXISTS hallucination_rate REAL,
  ADD COLUMN IF NOT EXISTS eval_method        VARCHAR(8);

-- Drift queries scan recent eval rows per (action_type, resolved_model) ordered by
-- time; this partial index keeps that sweep cheap once eval scores are populated.
CREATE INDEX IF NOT EXISTS idx_run_outcomes_eval
  ON run_model_outcomes(action_type, resolved_model, created_at)
  WHERE faithfulness IS NOT NULL;
