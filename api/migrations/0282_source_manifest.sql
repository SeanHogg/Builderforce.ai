-- source_manifest: daily per-source manifest for gap detection (local scope)
CREATE TABLE IF NOT EXISTS source_manifest (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    VARCHAR(50) NOT NULL, -- e.g. github, jira, etc.
  source_name VARCHAR(255) NOT NULL,

  -- Granular detection scope: MISSING_FIELDS, MISSING_RECORDS, COUNT_MISMATCH_RANGES
  -- NOT NULL unless MISSING_FIELDS could be nil if source returns no fields at all
  manifest_scope JSONB NOT NULL,

  -- Normalized schema/hash: versioned, not drift-prone
  schema_hash VARCHAR(64) NOT NULL,

  -- Per-source-per-day rollup to feed the Report better
  sync_date   DATE NOT NULL,

  CONSTRAINT uq_source_manifest UNIQUE (provider, source_name, sync_date, schema_hash)
);

-- daily_gap_stats: per-source-per-day rollup (limit table size, better report query performance)
CREATE TABLE IF NOT EXISTS daily_gap_stats (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    VARCHAR(50) NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  sync_date   DATE NOT NULL,

  -- 0-based count rollups for each severity
  critical_gaps INTEGER NOT NULL DEFAULT 0,
  warning_gaps  INTEGER NOT NULL DEFAULT 0,
  info_gaps     INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT uq_daily_gap_stats UNIQUE (provider, source_name, sync_date)
);

-- Create index for scans by tenant + provider + date
CREATE INDEX IF NOT EXISTS idx_source_manifest_tenant_provider_date ON source_manifest(tenant_id, provider, sync_date);
CREATE INDEX IF NOT EXISTS idx_daily_gap_stats_tenant_provider_date ON daily_gap_stats(tenant_id, provider, sync_date);
CREATE INDEX IF NOT EXISTS idx_daily_gap_stats_tenant ON daily_gap_stats(tenant_id);