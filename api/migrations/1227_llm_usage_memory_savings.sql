-- 1227 · What memory saved, recorded ON the usage ledger.
--
-- The savings ledger is six columns on `llm_usage_log`, not a sibling table and not a
-- second write path: the one writer (`recordUsageRow`) stamps them on the row it is
-- already writing, from the `metadata.memory` the run loop already sends with each call.
-- Mirror: transactional-migrations/0016 (the operational endpoint holds this relation in
-- production; this track holds it locally and in tests).
--
--   savings_source           null on a real call; on an AVOIDED call (calls = 0, every
--                            spend column 0) which stood in for the model:
--                            memory_answer | evermind_answer | response_cache
--   savings_estimated        recorded figure (false) vs ~4-chars-per-token estimate (true)
--   saved_prompt_tokens      avoided call: its prompt; real call: what compaction trimmed
--   saved_completion_tokens  avoided call: its completion
--   recall_prompt_tokens     what recall ADDED to this call's prompt (the cost side)
--   saved_cost_usd_millicents NET list-price value (saved − recall overhead); may be < 0
--
-- All NOT NULL DEFAULT 0/false, so every existing row reads as "memory did nothing"
-- and no existing reader's sums move.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS savings_source VARCHAR(24);
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS savings_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS recall_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_cost_usd_millicents INTEGER NOT NULL DEFAULT 0;
