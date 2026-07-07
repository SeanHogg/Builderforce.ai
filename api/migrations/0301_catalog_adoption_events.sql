-- 0301_catalog_adoption_events.sql
-- Generic, timestamped adoption event log for the marketplace catalog kinds
-- (skill | persona | prompt). Backs the over-time series in /api/catalog-analytics
-- for events that have no other timestamped home (notably true prompt "uses").
-- Existing timestamped rows (artifact_assignments, prompt_library_stars/versions)
-- are unioned in by the compute layer; this table captures live install/usage.
--
--   kind        skill | persona | prompt
--   item_id     the catalog item's stable id (prompt entry uuid, artifact slug)
--   event_type  install | usage
--
-- Append-only telemetry. Idempotent.

CREATE TABLE IF NOT EXISTS catalog_adoption_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        VARCHAR(16) NOT NULL,
  item_id     VARCHAR(128) NOT NULL,
  item_name   VARCHAR(255),
  event_type  VARCHAR(16) NOT NULL DEFAULT 'install',
  actor_id    VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot read path: a tenant's events for one kind within a time window.
CREATE INDEX IF NOT EXISTS idx_catalog_events_tenant_kind_time
  ON catalog_adoption_events(tenant_id, kind, created_at DESC);

-- Per-item rollups (top-N adopted items).
CREATE INDEX IF NOT EXISTS idx_catalog_events_tenant_kind_item
  ON catalog_adoption_events(tenant_id, kind, item_id);
