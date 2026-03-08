-- Chat sessions: one row per conversation session per claw
CREATE TABLE chat_sessions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id     INTEGER NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  session_key VARCHAR(255) NOT NULL,
  started_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMP,
  msg_count   INTEGER NOT NULL DEFAULT 0,
  last_msg_at TIMESTAMP
);

CREATE INDEX chat_sessions_tenant_claw_idx ON chat_sessions(tenant_id, claw_id);
CREATE INDEX chat_sessions_session_key_idx ON chat_sessions(claw_id, session_key);

-- Chat messages: individual messages within a session
CREATE TABLE chat_messages (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id     INTEGER NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        VARCHAR(16) NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  metadata    TEXT,
  seq         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_messages_session_seq_idx ON chat_messages(session_id, seq);
