-- Chat MODE — "am I asking a question, or asking for work to be done?"
--
-- Two modes per conversation:
--   'chat' — CONVERSATIONAL. Read, reason, answer. No board work is minted as a
--            side effect of answering.
--   'work' — EXECUTIONAL. Identified work becomes a ticket that is created, scoped,
--            linked to the conversation, statused, AND dispatched to an agent.
--
-- WHY: the chat⇄work linking directive used to ride EVERY Brain run unconditionally
-- (brain-embedded/src/brainRunStore.ts), so "what does this error mean?" was answered
-- by a model that had also been told to open, staff and status a ticket about it.
-- There was no way to just ask a question, and — after the fact — no column that told
-- a conversation apart from an execution. This is the discriminator for both: it gates
-- the directive at runtime, and it makes usage readable as conversations vs executions.
--
-- DEFAULT 'chat' is deliberate and applies to existing rows: asking must never be the
-- thing that opens a ticket. Work is opt-in, per conversation. The singleton team and
-- manager chats are forced to 'work' in code (resolveChatMode) regardless of the
-- column, because their whole purpose is to record and drive work.
--
-- Free-form varchar rather than a PG enum, matching `capability` (0345): the mode
-- vocabulary is owned by brain-embedded/src/chatMode.ts and an unknown value resolves
-- to the default on read, so there is no second copy here to drift.

ALTER TABLE brain_chats ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'chat';

-- The Creation Canvas is the other conversation surface (its composer drives a canvas
-- turn rather than a Brain chat), so it carries the same mode on its session.
ALTER TABLE creation_sessions ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'chat';

-- Backs the mode usage rollup (/api/insights/chat-modes): counts and execution
-- outcomes bucketed by mode over a trailing window, per tenant.
CREATE INDEX IF NOT EXISTS idx_brain_chats_tenant_mode
  ON brain_chats (tenant_id, mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creation_sessions_tenant_mode
  ON creation_sessions (tenant_id, mode, created_at DESC);
