-- Brain chats: server-persisted brainstorming / LLM conversations
CREATE TABLE IF NOT EXISTS brain_chats (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title       VARCHAR(500) NOT NULL DEFAULT 'New chat',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_chats_tenant ON brain_chats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brain_chats_user ON brain_chats(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_brain_chats_project ON brain_chats(tenant_id, project_id);

-- Brain messages: individual messages within a brain chat
CREATE TABLE IF NOT EXISTS brain_messages (
  id         SERIAL PRIMARY KEY,
  chat_id    INTEGER NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  role       VARCHAR(16) NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  metadata   TEXT,
  seq        INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_messages_chat ON brain_messages(chat_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_messages_chat_seq ON brain_messages(chat_id, seq);

-- Chat memories: compressed summaries of individual brain chats
CREATE TABLE IF NOT EXISTS chat_memories (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id    INTEGER NOT NULL UNIQUE REFERENCES brain_chats(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  summary    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_memories_tenant ON chat_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_memories_project ON chat_memories(tenant_id, project_id);

-- Project memories: consolidated summaries across all chats for a project
CREATE TABLE IF NOT EXISTS project_memories (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  consolidated_summary  TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_memories_tenant ON project_memories(tenant_id);
