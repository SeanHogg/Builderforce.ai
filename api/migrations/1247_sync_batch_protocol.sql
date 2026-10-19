-- 1247 · Synchronization — the server half of the versioned batch sync protocol
-- (docs/design/vsix-offline-first-architecture-review.md, G15–G18, G25).
--
-- Four tables, one concern: `POST /api/sync/v1/push` must be able to answer a
-- REPLAYED batch without re-executing it (G16), a retried create without a second
-- entity (client-entity uniqueness), a stale write without overwriting newer state
-- (baseVersion), and a reconnecting device with only what changed (delta cursor).
--
--   sync_events           — the durable receipt journal. (tenant, device, event) is
--                           unique, so a crash between server commit and client
--                           acknowledgement replays to the SAME receipt instead of a
--                           second mutation. Payload and hashes are retained so a
--                           rejection stays inspectable and a replay is verifiable.
--   sync_entity_mappings  — client entity UUID → server id + current version. The
--                           optimistic-concurrency counter lives here: every accepted
--                           mutation bumps server_version exactly once.
--   sync_records          — the sync projection: one row per synced entity holding
--                           the current LocalRecord-shaped payload, provenance
--                           (client-reported, G25) and the tombstone (`deleted_at`).
--                           Entities with a real server aggregate (tickets, projects)
--                           are ALSO written to their domain table by the owning
--                           context's import use case; this row is what pull serves.
--   sync_changes          — the append-only delta log behind pull cursors. `seq` is
--                           the cursor; a cursor older than the retained window gets
--                           `resnapshotRequired`, never silently wrong data (G18).
--
-- sync_events and sync_changes are registered in application/maintenance/
-- sweptTables.ts (90d / 30d); the autovacuum tuning below is what
-- check:swept-tables requires of a later migration on the same endpoint.

CREATE TABLE IF NOT EXISTS sync_events (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id varchar(128) NOT NULL,
  event_id uuid NOT NULL,
  batch_id varchar(128) NOT NULL,
  client_entity_id uuid NOT NULL,
  entity_type varchar(40) NOT NULL,
  operation varchar(16) NOT NULL,
  schema_version integer NOT NULL,
  local_sequence bigint NOT NULL,
  occurred_at timestamp NOT NULL,
  received_at timestamp NOT NULL DEFAULT now(),
  base_version integer,
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  destination jsonb NOT NULL,
  payload jsonb NOT NULL,
  payload_hash varchar(128) NOT NULL,
  status varchar(24) NOT NULL,
  server_id varchar(128),
  server_version integer,
  detail text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_events_event
  ON sync_events (tenant_id, device_id, event_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_entity
  ON sync_events (tenant_id, entity_type, client_entity_id);

CREATE TABLE IF NOT EXISTS sync_entity_mappings (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL,
  server_version integer NOT NULL,
  destination_key text NOT NULL,
  payload_hash varchar(128) NOT NULL,
  created_by_device varchar(128) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_entity_mappings_client
  ON sync_entity_mappings (tenant_id, entity_type, client_entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_entity_mappings_server
  ON sync_entity_mappings (tenant_id, entity_type, server_id);

CREATE TABLE IF NOT EXISTS sync_records (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  destination_key text NOT NULL,
  occurred_at timestamp NOT NULL,
  received_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash varchar(128) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_records_client
  ON sync_records (tenant_id, entity_type, client_entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_records_snapshot
  ON sync_records (tenant_id, destination_key, entity_type, client_entity_id);

CREATE TABLE IF NOT EXISTS sync_changes (
  seq bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  client_entity_id uuid NOT NULL,
  server_id varchar(128) NOT NULL,
  operation varchar(16) NOT NULL,
  version integer NOT NULL,
  destination_key text NOT NULL,
  record jsonb NOT NULL,
  occurred_at timestamp NOT NULL,
  recorded_at timestamp NOT NULL DEFAULT now(),
  device_id varchar(128) NOT NULL,
  event_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_cursor
  ON sync_changes (tenant_id, seq);

ALTER TABLE sync_events  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
ALTER TABLE sync_changes SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
