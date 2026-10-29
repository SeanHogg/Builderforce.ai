-- 0026 · The uniform outcome row's token fields (PRD 35 §8.2, WS6) — completes 0025.
--
-- §8.2 lists `tokens` and `cache_read_tokens` on the ONE row every run writes, beside the
-- efficiency fields 0025 added. A client run has no execution id, so its usage rows
-- cannot be summed back to it later: the run counts its own tokens and the row carries
-- them. Mirror: migrations/1282 (this track holds the relation in production; the core
-- track holds it locally and in tests).
--
-- Expand only: nullable, no default — a row scored before 0026 reads "not measured".

ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS tokens INTEGER;
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
