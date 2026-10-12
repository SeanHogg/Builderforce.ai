-- 1212 · Retire `brain_chat_trace` (retired 2026-10-11).
--
-- A duplicate of the step rows in `brain_chat_messages` (role 'tool', metadata kind
-- 'step'), the single store for run steps. Every Brain-run step was written twice —
-- incrementally as a step row by the run loop, then again here at run end — and
-- everything that reads steps (timeline, diagnostics, prior research, turn rating)
-- already reads the step rows. The server-run addressed-agent reply now writes its
-- steps as step rows too, so nothing writes or reads this table.
--
-- This is the PRIMARY copy, frozen since the 2026-10-03 move to the operational
-- endpoint; transactional-migrations/0014 drops the live one.

DROP TABLE IF EXISTS brain_chat_trace;
