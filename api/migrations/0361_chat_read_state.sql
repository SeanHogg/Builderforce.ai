-- 0361_chat_read_state.sql
-- Per-user read high-water mark for a Brain chat, so the web can show an "unread"
-- badge when execution milestones (or a teammate/agent message) land in a chat the
-- user is not currently viewing — closing the "web has no unread badge for
-- un-mounted chats" gap (the VSIX already lights attention icons via AttentionPoller).
--
-- Keyed by (chat_id, user_id) so it covers BOTH a chat's owner (who has no
-- chat_members row) and shared-chat participants uniformly. `last_read_seq` is
-- compared against brain_chat_messages.seq (monotonic = the message's own PK id):
-- a chat has unread when max(seq) > last_read_seq. A row exists only once a user
-- has OPENED the chat, so a never-opened shared chat is "new/undiscovered", not
-- "unread" — unread only accrues on conversations the user has actually read.

CREATE TABLE IF NOT EXISTS chat_read_state (
  chat_id       integer     NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  user_id       varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  last_read_seq integer     NOT NULL DEFAULT 0,
  updated_at    timestamp   NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- The unread sweep is per-user (across all the user's read chats), so index on it.
CREATE INDEX IF NOT EXISTS idx_chat_read_state_user ON chat_read_state(tenant_id, user_id);
