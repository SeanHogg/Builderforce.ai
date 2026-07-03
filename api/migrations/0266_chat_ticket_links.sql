-- 0266_chat_ticket_links.sql
-- Tie Brain chats to work items, and let chats be consolidated.
--
-- A Brain conversation (VS Code / web / on-prem) is already tied to a project.
-- This adds two things so a chat can be pinned to the actual WORK it is about:
--
--   1. chat_ticket_links — a many-to-many, lineage-aware edge between a chat and
--      a "ticket" of ANY tier (portfolio | objective/OKR | initiative | epic |
--      task). MANY chats can reference the same ticket, and ONE chat can reference
--      MANY tickets (e.g. a single brainstorm that spawned several tasks). The
--      link_type records lineage: 'created' = this ticket was born from this chat,
--      'linked' = the chat was attached to an existing ticket after the fact.
--
--   2. ide_project_chats.merged_into_chat_id — the consolidation pointer. When
--      several chats are merged into one, the sources are archived and stamped
--      with the surviving chat's id, so history is preserved and any ticket that
--      referenced a source still resolves to the one surviving conversation.
--
-- Agent invites into a chat reuse the existing agent_assignments table with a new
-- 'chat' scope (scope_id = chat id) — no new table needed.

-- 1. Chat <-> ticket links (M:N + lineage) -----------------------------------
CREATE TABLE IF NOT EXISTS chat_ticket_links (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- The conversation this edge belongs to.
  chat_id      INTEGER NOT NULL REFERENCES ide_project_chats(id) ON DELETE CASCADE,
  -- Which work-item tier the ref points at. Mirrors the planning-spine node kinds.
  --   'portfolio' | 'objective' | 'initiative' | 'epic' | 'task'
  ticket_kind  VARCHAR(12) NOT NULL,
  -- The target id AS TEXT: tasks.id (epic/task) is an integer; portfolio/objective/
  -- initiative ids are UUIDs. Stored as text so one column addresses every tier.
  ticket_ref   VARCHAR(64) NOT NULL,
  -- Lineage: 'created' (ticket spawned from this chat) | 'linked' (attached later).
  link_type    VARCHAR(16) NOT NULL DEFAULT 'linked',
  -- Who made the link: a user id or an agent ref (for provenance / audit).
  created_by   VARCHAR(64),
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- One edge per (chat, ticket). Re-linking updates link_type rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_ticket_links
  ON chat_ticket_links(chat_id, ticket_kind, ticket_ref);

-- Forward lookup: "which tickets does this chat touch?" (chat header summary).
CREATE INDEX IF NOT EXISTS idx_chat_ticket_links_chat
  ON chat_ticket_links(tenant_id, chat_id);

-- Reverse lookup / lineage: "which chats reference this ticket?" (ticket drawer).
CREATE INDEX IF NOT EXISTS idx_chat_ticket_links_ticket
  ON chat_ticket_links(tenant_id, ticket_kind, ticket_ref);

-- 2. Consolidation pointer on the chat ---------------------------------------
-- When chats are merged, each source is archived and points at the survivor.
ALTER TABLE ide_project_chats
  ADD COLUMN IF NOT EXISTS merged_into_chat_id INTEGER REFERENCES ide_project_chats(id) ON DELETE SET NULL;
