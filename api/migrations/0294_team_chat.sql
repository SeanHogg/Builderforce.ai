-- Team Chat — a canonical, always-there GROUP chat for a whole team, distinct from
-- the per-user Brain "brainstorm" chats. It reuses the entire Brain chat stack
-- (brain_chats + brain_chat_messages + chat_members humans + agent_assignments
-- scope='chat' agents), so humans AND agents post into the same conversation.
--
-- There is exactly ONE team chat per SCOPE:
--   • project team chat  — origin='team', project_id = the project        → "the project team"
--   • team    team chat  — origin='team', team_id    = a workforce team   → "that team"
--   • tenant  team chat  — origin='team', both NULL                       → "the broader team"
--
-- All are visibility='shared' so every tenant teammate can open and post without an
-- explicit invite (the whole team IS the audience). Agents (a PM/manager agent asking
-- for status updates, or sharing a burndown) post via the team_chat.* built-in tools.
ALTER TABLE brain_chats
  ADD COLUMN IF NOT EXISTS team_id integer REFERENCES teams(id) ON DELETE CASCADE;

-- The unique index makes get-or-create race-safe: COALESCE folds the NULL project/team
-- of a broader-team chat into a single key (0) so two concurrent resolves can never
-- mint two chats for the same scope. Scoped to live (non-archived) rows so a future
-- archive+recreate is still possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_chat_scope
  ON brain_chats (tenant_id, COALESCE(project_id, 0), COALESCE(team_id, 0))
  WHERE origin = 'team' AND is_archived = false;

-- Teams can give themselves an avatar (shown on the team card + as the chat's face).
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS avatar_url varchar(500);

-- A meeting can BE a team's chat: link the meeting to the team chat that is its
-- persistent backchannel. Joining the meeting opens the chat; people who can't attend
-- still post their updates there, and the conversation keeps going after the call.
-- ON DELETE SET NULL — archiving a chat must never delete meeting history.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS chat_id integer REFERENCES brain_chats(id) ON DELETE SET NULL;
