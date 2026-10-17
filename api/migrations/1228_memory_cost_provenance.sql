-- 1228 · Two facts the savings ledger (1227) needs and nothing recorded.
--
-- 1. project_facts.origin_* — what PRODUCING a fact cost. The Q&A cache stored only an
--    answer's text, so a replay could say "the model was skipped" but never "and that
--    saved $X". The model and token counts of the turn that wrote the answer are its
--    provenance, the same family as `origin_execution_id`; a replay is then priced from
--    a recorded figure, not a guess. Null for facts written before this column, or by a
--    writer that does not know its cost — those replays are recorded as estimates.
--
-- 2. brain_chats.memory_enabled — the per-chat Memory switch. It lived in each browser's
--    localStorage under three different keys, so the same chat was "on" in the editor
--    and "off" on the web, and the server (and the editor's own recall tools) never saw
--    it. A property of the conversation, like `mode`.

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_model VARCHAR(200);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_prompt_tokens INTEGER;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_completion_tokens INTEGER;

ALTER TABLE brain_chats ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT true;
