-- 0323 — Persist the finetune evaluation breakdown on the IDE-native training job.
--
-- The IDE-native evaluate route (`POST /ide/training/:id/evaluate`) previously
-- fabricated a flat 0.85 score and persisted NOTHING durable (only a log line),
-- so the AI-judge sub-scores were computed-then-discarded. These columns give the
-- IDE pipeline the same queryable eval breakdown the worker pipeline records on
-- `ide_agents.eval_score`, so the training panel can show correctness / reasoning
-- / hallucination trends instead of a one-shot log.
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS eval_score REAL;
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS eval_code_correctness REAL;
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS eval_reasoning_quality REAL;
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS eval_hallucination_rate REAL;
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS eval_details TEXT;
ALTER TABLE ide_training_jobs ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;
