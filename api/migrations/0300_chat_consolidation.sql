-- 0300_chat_consolidation.sql
-- Chat consolidation: merge multiple chats into one with sub-threading support.
--
-- This migration adds the structure needed for:
--   - Consolidating multiple chats into a single target chat
--   - Displaying source chats as sub-threads within the target
--   - Maintaining separate metadata per sub-thread

-- 1. Support for sub-threads within a consolidated chat ---------------------------------
-- When multiple chats are merged, each becomes a sub-thread under the target.
-- A chat can be TARGET (the survivor) or a SUB_THREAD (consolidated into another).
ALTER TABLE brain_chats
  ADD COLUMN IF NOT EXISTS sub_thread_of_chat_id INTEGER REFERENCES brain_chats(id) ON DELETE CASCADE;

-- Flag to indicate if this chat has been archived as a result of consolidation.
ALTER TABLE brain_chats
  ADD COLUMN IF NOT EXISTS consolidation_status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (consolidation_status IN ('active', 'consolidated', 'failed'));

-- When archived via consolidation, record which chat it was merged into.
-- This is a mirror of merged_into_chat_id for audit/history (same meaning here).
ALTER TABLE brain_chats
  ADD COLUMN IF NOT EXISTS consolidated_into_chat_id INTEGER REFERENCES brain_chats(id) ON DELETE SET NULL;

-- Indexes for efficient lookup/queries
CREATE INDEX IF NOT EXISTS idx_brain_chats_sub_thread_of
  ON brain_chats(sub_thread_of_chat_id) WHERE sub_thread_of_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brain_chats_consolidated_into
  ON brain_chats(consolidated_into_chat_id) WHERE consolidated_into_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brain_chats_consolidation_status
  ON brain_chats(tenant_id, consolidation_status);

-- 2. Source-to-target link table with sub-thread metadata ---------------------------------
-- When consolidating, tracks which source chat this sub-thread came from,
-- along with metadata for display (title, order, etc.).
CREATE TABLE IF NOT EXISTS chat_consolidation_links (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- The consolidated chat that contains all sub-threads
  consolidated_chat_id INTEGER NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  -- Which source chat this sub-thread came from
  source_chat_id INTEGER NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  -- Order within the consolidated view (used for display)
  display_order  INTEGER NOT NULL DEFAULT 0,
  -- Metadata for UI: title/name of the original source, custom notes
  source_title   VARCHAR(VARYING(500)),
  source_summary TEXT,
  -- Timestamp when this link was created
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One consolidated view per source chat (a source can only be in one consolidation)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_consolidation_links_source
  ON chat_consolidation_links(source_chat_id);

-- Lookup: which sub-threads belong to a consolidated view
CREATE INDEX IF NOT EXISTS idx_chat_consolidation_links_consolidated
  ON chat_consolidation_links(tenant_id, consolidated_chat_id, display_order);

-- Lookup: which consolidated view a source chat belongs to (reverse)
CREATE INDEX IF NOT EXISTS idx_chat_consolidation_links_reverse
  ON chat_consolidation_links(tenant_id, source_chat_id);

-- 3. Graceful handling of consolidations ------------------------------------------------
-- The consolidation process is idempotent: if a target/source already marked as
-- consolidated, we return the existing state. This avoids double-merging.