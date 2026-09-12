-- 1157_evermind_coding_eval.sql
--
-- The Evermind CODING-QUALITY GATE's evidence (operator decision 2026-09-12:
-- "Evermind for IDE coding => quality has to be 90%"). A project's Evermind head may
-- serve IDE/VS Code coding turns and agent task runs ONLY when it carries a recorded
-- coding-eval score >= 90% of the frontier baseline's score on the SAME eval, taken
-- against THAT head version (see api/src/application/llm/evermindCodingGate.ts).
--
-- Nothing persisted a per-head eval before this, so the gate had nothing to read.
-- One eval per project row, stamped with the version it scored: a merge advances
-- `version`, which makes the recorded eval stale (gate closes) until it is re-run.
--
--   * coding_eval_version        — head version the eval scored (NULL = never evaluated)
--   * coding_eval_score          — Evermind mean score on the coding eval (0..1)
--   * coding_eval_baseline_score — frontier baseline mean score on the SAME eval (0..1)
--   * coding_eval_baseline_model — the frontier model the baseline ran on
--   * coding_eval_dataset        — the eval dataset both reports came from
--   * coding_eval_at             — when the eval was recorded
--
-- Idempotent (IF NOT EXISTS). Existing rows get NULLs → no eval → gate closed, which
-- is exactly today's behaviour for coding turns: nothing is flipped on.

ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_version INTEGER;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_score REAL;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_baseline_score REAL;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_baseline_model TEXT;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_dataset TEXT;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS coding_eval_at TIMESTAMP;
