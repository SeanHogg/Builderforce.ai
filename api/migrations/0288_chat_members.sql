-- Human participants in a Brain chat — the shared-access model that lets a
-- person who is NOT the chat owner open, read, and post in a chat they were
-- invited to. Until now a brain_chats row had a single owner (brain_chats.user_id)
-- and every access check filtered by it, so a chat was strictly single-owner.
--
-- Agents are invited via agent_assignments(scope='chat'); this table is the human
-- equivalent. A member is either:
--   • active  — user_id is a real users.id (an existing account); they get access
--               immediately and see the chat in their list.
--   • pending — invited_email is set and user_id is NULL (the invitee has no
--               account / is not yet a member of this tenant). On their next chat
--               access with a matching email the row auto-converts to active
--               (user_id filled, status='active'), mirroring tenant_invitations.
--
-- Access granted to a member: open the chat, read its transcript, post turns.
-- Owner-only admin (rename / archive / invite / remove / lock) stays with
-- brain_chats.user_id.
--
-- VISIBILITY (the LOCK primitive): Brain chats are global to their project+tenant,
-- so by default any tenant teammate can SEE, OPEN, and JOIN a chat to collaborate —
-- contributing auto-records them as a member (the chat's live audience). A chat can
-- be LOCKED to make it private: once visibility='locked' only the owner + explicit
-- members may see or open it. New default is 'shared'.
ALTER TABLE brain_chats
  ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'shared';  -- shared | locked

CREATE TABLE IF NOT EXISTS chat_members (
  id             serial PRIMARY KEY,
  chat_id        integer NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     uuid REFERENCES segments(id) ON DELETE CASCADE,
  user_id        varchar(36) REFERENCES users(id) ON DELETE CASCADE,  -- resolved member (NULL while pending)
  invited_email  varchar(255),                                        -- lower-cased; set for cold invites
  role           varchar(24) NOT NULL DEFAULT 'participant',
  status         varchar(16) NOT NULL DEFAULT 'active',               -- active | pending
  invited_by     varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

-- One membership per (chat, user) once resolved; one pending row per (chat, email).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_members_user
  ON chat_members(chat_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_members_email
  ON chat_members(chat_id, lower(invited_email)) WHERE invited_email IS NOT NULL;

-- "Which chats can this user open?" — the shared-access lookup, per tenant.
CREATE INDEX IF NOT EXISTS idx_chat_members_user
  ON chat_members(tenant_id, user_id) WHERE user_id IS NOT NULL;
-- Pending-invite conversion lookup by email (a user logging in / opening a chat).
CREATE INDEX IF NOT EXISTS idx_chat_members_email
  ON chat_members(tenant_id, lower(invited_email)) WHERE invited_email IS NOT NULL;
