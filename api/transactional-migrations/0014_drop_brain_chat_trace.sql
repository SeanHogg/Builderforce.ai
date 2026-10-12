-- 0014 · Retire `brain_chat_trace` (retired 2026-10-11) — OPERATIONAL mirror of
-- migrations/1212; see that file for the full reasoning.
--
-- A duplicate of the step rows in `brain_chat_messages` (role 'tool', metadata kind
-- 'step'), the single store for run steps. Created here by 0013 when agent-run
-- telemetry moved to this endpoint; nothing writes or reads it any more.

DROP TABLE IF EXISTS brain_chat_trace;
