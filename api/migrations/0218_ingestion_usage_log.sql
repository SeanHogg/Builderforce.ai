-- 0218 — Data-ingestion ledger (consumption meter, non-token half).
-- Append-only record of data PROCESSED through system integrations (repo content
-- imports today). Summed month-to-date against the plan's ingestion allowance so
-- free-vs-paid caps the real cost driver (linking/processing lots of repo data)
-- without capping visibility. Mirrors llm_usage_log's shape, byte-side.

CREATE TABLE IF NOT EXISTS ingestion_usage_log (
  id              SERIAL       PRIMARY KEY,
  tenant_id       INTEGER      REFERENCES tenants(id) ON DELETE SET NULL,
  project_id      INTEGER      REFERENCES projects(id) ON DELETE SET NULL,
  source          VARCHAR(32)  NOT NULL DEFAULT 'repo_import',
  provider        VARCHAR(32),
  bytes_ingested  BIGINT       NOT NULL DEFAULT 0,
  items_ingested  INTEGER      NOT NULL DEFAULT 0,
  metadata        TEXT,
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Hot path is "sum bytes for this tenant since the month start" — tenant + time.
CREATE INDEX IF NOT EXISTS idx_ingestion_usage_tenant_created
  ON ingestion_usage_log(tenant_id, created_at DESC);
