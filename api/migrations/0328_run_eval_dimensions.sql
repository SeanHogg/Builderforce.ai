-- 0328_run_eval_dimensions.sql
--
-- Layer 6 (Observability & Evaluation) — Per-dimension evidence for run evaluations.
--
-- The platform already scores runs on faithfulness, answerRelevance, contextRelevance,
-- hallucinationRate via run_model_outcomes (migration 0222). This does NOT explain WHY,
-- forcing users to trust opaque ratings or dig through raw data manually. This change adds
-- per-dimension evidence: quoted excerpts, referenced data rows, model reasoning traces,
-- or rule matches that drove each score.
--
-- The run_eval_dimensions table is structured as denormalized evidence per dimension per run:
--   • run_id                — foreign key to run_model_outcomes (null when run is unscorable)
--   • dimension             — one of: faithfulness | answer_relevance | context_relevance | hallucination_rate
--   • source_type           — excerpt | data_ref | rule | reasoning_trace
--   • content               — quoted text, data reference, rule ID, or reasoning output
--   • location              — char offset, row ID, or step index in the source material
--   • polarity              — positive | negative | neutral (derived from score relative to threshold)
--   • evidence_quality      — low (missing) | good (>=1 evidence) | poor (<1 but present)
--
-- New columns on run_model_outcomes when this migration is pending:
--   • evidence_quality     — low (no evidence) | good (>=1 good) | poor (<1 but present)
--   • evidence_coverage    — (dimensions_with_evidence / total_dimensions) as percentage
--
-- Evidence is captured at scoring time in semanticEval.ts, then written in an
-- atomic transaction along with the primary eval scores.
--
-- IDempotent: schema must validate without errors; this table is appended to.

ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS evidence_quality VARCHAR(16) CHECK (evidence_quality IN ('low', 'good', 'poor')),
  ADD COLUMN IF NOT EXISTS evidence_coverage REAL CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS run_eval_dimensions (
  run_id INTEGER REFERENCES run_model_outcomes(id) ON DELETE CASCADE,
  dimension VARCHAR(32) NOT NULL CHECK (dimension IN ('faithfulness', 'answer_relevance', 'context_relevance', 'hallucination_rate')),
  source_type VARCHAR(16) NOT NULL CHECK (source_type IN ('excerpt', 'data_ref', 'rule', 'reasoning_trace')),
  content TEXT NOT NULL,
  location TEXT,
  polarity VARCHAR(16) CHECK (polarity IN ('positive', 'negative', 'neutral')),
  evidence_quality VARCHAR(16) CHECK (evidence_quality IN ('low', 'good', 'poor')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT run_eval_dimensions_pkey PRIMARY KEY (run_id, dimension, source_type)
);

-- Index for efficient per-run evidence retrieval.
CREATE INDEX IF NOT EXISTS idx_run_eval_dimensions_run
  ON run_eval_dimensions(run_id);