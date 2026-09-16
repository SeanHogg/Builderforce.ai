-- 1178 · Persist the chat's own diagnostic verdict, so "why did that run not finish?"
--        is a fact and not a re-derivation.
--
-- WHY A TABLE, AND WHY NOT `brain_chat_trace`.
-- The trace is PER-STEP: one row per llm/tool/error event, written by the run as it
-- happens. It says what occurred. It cannot say what it MEANT — that the turn stopped
-- because the tool budget went to a 96-tool canvas surface, or that nobody was dispatched
-- because the project has no staffed agent for the lane. That verdict is computed ONCE,
-- at capture time, from the whole run; storing it is the difference between answering the
-- question and re-computing an answer that may no longer be reproducible (the trace is
-- capped, the models rotate, the staffing changes).
--
-- One fact in one place: the report is a single JSON document, written whole. And because
-- `likely_cause` is a column rather than a JSON path, the same rows answer the question
-- ACROSS chats — "how often is this the reason?" is an index scan, not a table scan with a
-- jsonb extraction per row.
--
-- Retention is enforced by the writer (`application/brain/chatDiagnosticsStore.ts`, 25 per
-- chat) rather than by a trigger: the cap is a product decision that belongs beside the
-- clamp on report size, not split between two places that can disagree.
--
-- `report` is jsonb, not text: the reports are queried, and a text column would make every
-- such question a parse. `captured_at` is the CLIENT's instant (when the snapshot was
-- taken) and `created_at` the server's (when it arrived) — a slow upload must not be able
-- to reorder captures.

CREATE TABLE IF NOT EXISTS brain_chat_diagnostics (
  id             serial PRIMARY KEY,
  chat_id        integer NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  surface        varchar(32) NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  likely_cause   varchar(64),
  captured_at    timestamptz NOT NULL,
  report         jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The only read shape: the latest captures for one chat. `id DESC` rather than
-- `captured_at DESC` because `id` is the arrival order the store retains on, and two
-- captures can share a millisecond.
CREATE INDEX IF NOT EXISTS idx_brain_chat_diagnostics_chat
  ON brain_chat_diagnostics (chat_id, id DESC);

-- Cross-chat: "which cause is this workspace hitting?" — the question the per-step trace
-- could never answer.
CREATE INDEX IF NOT EXISTS idx_brain_chat_diagnostics_cause
  ON brain_chat_diagnostics (tenant_id, likely_cause);
