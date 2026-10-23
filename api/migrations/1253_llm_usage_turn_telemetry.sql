-- 1253 · Per-turn cost telemetry on the usage ledger (LLM Cost Optimization · A1).
--
-- Three nullable columns on `llm_usage_log`, written by the one writer
-- (`recordUsageRow`) on the row it already writes. Mirror:
-- transactional-migrations/0019 (the operational endpoint holds this relation in
-- production; this track holds it locally and in tests).
--
--   reasoning_tokens    hidden reasoning tokens, a SUBSET of completion_tokens, as the
--                       vendor reported them (`completion_tokens_details.reasoning_tokens`
--                       on OpenAI / OpenRouter). NULL when the vendor gives no split —
--                       Anthropic counts extended thinking inside output_tokens — so NULL
--                       means "not reported", never "zero reasoning".
--   turn_index          1-based position of the call in its run's turn loop; NULL outside
--                       a loop. The day fold keeps MAX(turn_index), the run's turn count.
--   tool_schema_tokens  ESTIMATED (chars/4) tokens the advertised tool schemas cost on
--                       the call; NULL when unmeasured. The day fold sums it.
--
-- Context-by-category and the tenant's cost-lever arms ride in `metadata`
-- (`context`, `costLevers`), not columns: they are read only by the A4 cost metrics.
--
-- All nullable with no default, so existing rows read as "not measured" and no
-- existing reader's sums move.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS turn_index INTEGER;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS tool_schema_tokens INTEGER;
