-- Migration: External board sync (Slice 2).
-- Connect 1..N external boards (GitHub/Jira/Freshworks/Rally) into one BF
-- project via a stored integration credential. Poll new tickets in (cursor),
-- map them to BF tasks (labeled with their source), and reliably write changes
-- back out via a transactional outbox. external_ticket_links is the idempotency
-- ledger keyed by (connection_id, external_id).

-- Extend the integration provider enum for Rally / Freshworks. ADD VALUE runs
-- as its own autocommit statement (the migrate runner does not wrap files in a
-- transaction) and is not used elsewhere in this migration.
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'rally';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'freshworks';

-- Source label on tasks: which external board a synced ticket came from.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source VARCHAR(24);

CREATE TABLE IF NOT EXISTS board_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  credential_id     UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  provider          VARCHAR(24) NOT NULL,
  external_board_id VARCHAR(255),
  status            VARCHAR(16) NOT NULL DEFAULT 'active',
  poll_cursor       TEXT,
  webhook_secret    VARCHAR(128),
  webhook_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  poll_interval_sec INTEGER NOT NULL DEFAULT 60,
  last_polled_at    TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_board_connections_segment ON board_connections;
CREATE TRIGGER trg_board_connections_segment BEFORE INSERT ON board_connections FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_board_connections_project ON board_connections(project_id, status);

CREATE TABLE IF NOT EXISTS external_ticket_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  connection_id    UUID NOT NULL REFERENCES board_connections(id) ON DELETE CASCADE,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  provider         VARCHAR(24) NOT NULL,
  external_id      VARCHAR(255) NOT NULL,
  external_url     VARCHAR(500),
  external_version VARCHAR(128),
  content_hash     VARCHAR(64),
  sync_state       VARCHAR(16) NOT NULL DEFAULT 'synced',
  last_inbound_at  TIMESTAMP,
  last_outbound_at TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_external_ticket_conn_extid UNIQUE (connection_id, external_id)
);
DROP TRIGGER IF EXISTS trg_external_ticket_links_segment ON external_ticket_links;
CREATE TRIGGER trg_external_ticket_links_segment BEFORE INSERT ON external_ticket_links FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_external_ticket_links_task ON external_ticket_links(task_id);

CREATE TABLE IF NOT EXISTS board_sync_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES board_connections(id) ON DELETE CASCADE,
  task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  change_set      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_board_sync_outbox_segment ON board_sync_outbox;
CREATE TRIGGER trg_board_sync_outbox_segment BEFORE INSERT ON board_sync_outbox FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_board_sync_outbox_due ON board_sync_outbox(status, next_attempt_at);
