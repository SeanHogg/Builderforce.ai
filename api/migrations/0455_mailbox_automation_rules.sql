-- 0455_mailbox_automation_rules.sql
-- Provider-neutral inbox rules that bind a connected mailbox to a workforce
-- agent. Sending remains governed by the mailbox allow_sending flag.

CREATE TABLE IF NOT EXISTS mailbox_automation_rules (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id    INTEGER NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  from_contains    VARCHAR(320) NOT NULL DEFAULT '',
  subject_contains VARCHAR(500) NOT NULL DEFAULT '',
  agent_ref        VARCHAR(128),
  response_mode    VARCHAR(16) NOT NULL DEFAULT 'draft',
  instructions     TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mailbox_rule_response_mode
    CHECK (response_mode IN ('draft', 'approval', 'automatic'))
);

CREATE INDEX IF NOT EXISTS idx_mailbox_automation_rules_connection
  ON mailbox_automation_rules(tenant_id, connection_id, enabled);

CREATE TABLE IF NOT EXISTS mailbox_automation_executions (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id      INTEGER NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  rule_id            INTEGER NOT NULL REFERENCES mailbox_automation_rules(id) ON DELETE CASCADE,
  message_id         VARCHAR(512) NOT NULL,
  sender             VARCHAR(500) NOT NULL,
  subject            VARCHAR(500) NOT NULL DEFAULT '',
  status             VARCHAR(24) NOT NULL DEFAULT 'processing',
  draft_text         TEXT,
  approval_id        VARCHAR(64),
  provider_sent_id   VARCHAR(512),
  error              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_automation_execution_message
  ON mailbox_automation_executions(tenant_id, rule_id, message_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_automation_executions_tenant
  ON mailbox_automation_executions(tenant_id, created_at DESC);
