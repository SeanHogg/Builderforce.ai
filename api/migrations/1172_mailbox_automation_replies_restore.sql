-- 1172_mailbox_automation_replies_restore.sql
-- Restore `mailbox_automation_replies` on databases that are missing it.
--
-- 0455 declares this table beside `mailbox_automation_rules`, yet the production
-- primary (schema of 2026-09-14) has the rules table and NOT this one. The
-- mailbox-automation cron sweep opens with a statement on it, so it has failed on
-- every frequent tick ("relation \"mailbox_automation_replies\" does not exist") and
-- no inbox rule has ever run there.
--
-- IF NOT EXISTS throughout: an environment built from scratch already has the table
-- from 0455, and this must be a no-op there. The definition is 0455's, unchanged.

CREATE TABLE IF NOT EXISTS mailbox_automation_replies (
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_automation_reply_message
  ON mailbox_automation_replies(tenant_id, connection_id, message_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_automation_replies_tenant
  ON mailbox_automation_replies(tenant_id, created_at DESC);
