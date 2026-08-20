-- 0007 — link a diagnostic trace to the cloud execution it served (OPERATIONAL copy).
--
-- ── WHAT WAS MISSING AND WHY IT MATTERED ────────────────────────────────────
-- A cloud run already stamped `traceId` into its `llm.complete` timeline event, so
-- the Observability surface displayed a trace id for every model turn. That id
-- resolved to NOTHING: `llm_traces` rows were only ever written by the gateway
-- ROUTES, and a cloud run calls `LlmProxyService.complete()` in-process without
-- passing through one. The run showed a correlation id nobody could look up, and
-- the run's own model + token facts stayed buried inside a JSON `args` blob on
-- `tool_audit_events` — parseable by the UI, not queryable by anything.
--
-- Writing the trace from the cloud engine fixes the first half. This column fixes
-- the second: with `execution_id` on the row, "every LLM turn of run N, with its
-- resolved model, vendor, token counts and duration" is one indexed read instead of
-- a JSON scan, which is what lets the run detail surface structured model+token
-- fields and deep-link each turn to its trace.
--
-- Nullable by design: gateway, IDE-chat, image, Brain and dataset traces serve no
-- execution, and inventing one would be a lie.
--
-- ── SCALAR ID, NO FK ────────────────────────────────────────────────────────
-- A bare integer with no REFERENCES clause, exactly like `tenant_id` on this table
-- and every other cross-database reference: `llm_traces` is written through
-- `buildTransactionalDatabase`, which targets the separate operational Neon account
-- whenever NEON_TRANSACTIONAL_DATABASE_URL is bound, and PostgreSQL cannot enforce
-- a foreign key across two accounts.
--
-- TWO TRACKS, DELIBERATELY: the primary twin is
-- api/migrations/0949_llm_traces_execution_link.sql. Both copies of this
-- table are live (the writer falls back to the primary database when the
-- operational secret is unbound), so a column added to only one of them is absent
-- exactly where the rows land.

ALTER TABLE llm_traces ADD COLUMN IF NOT EXISTS execution_id INTEGER;

-- The run-detail read: "this execution's LLM turns, oldest first". Partial because
-- only cloud-run traces carry an execution and they are a small slice of the table.
CREATE INDEX IF NOT EXISTS idx_llm_traces_execution
  ON llm_traces (execution_id, created_at)
  WHERE execution_id IS NOT NULL;
