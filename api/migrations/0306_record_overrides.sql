-- 0306 — Manual record overrides for ingested data
-- Stores manual field-level overrides on ingested records, applied at read time
-- without modifying the raw ingested data.

CREATE TABLE IF NOT EXISTS record_overrides (
  id                SERIAL      PRIMARY KEY,
  tenant_id         INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_id         TEXT        NOT NULL,
  field_name        TEXT        NOT NULL,
  override_value    TEXT        NOT NULL,
  override_type     TEXT       NOT NULL,  -- 'number', 'string', 'boolean', 'date', 'timestamp'
  reason            TEXT        NOT NULL,
  created_by        INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  data_domain       VARCHAR(64),  -- Optional domain restriction (e.g., 'finance')
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, record_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_record_overrides_tenant_record
  ON record_overrides(tenant_id, record_id, field_name);

CREATE INDEX IF NOT EXISTS idx_record_overrides_tenant
  ON record_overrides(tenant_id);

CREATE INDEX IF NOT EXISTS idx_record_overrides_record
  ON record_overrides(record_id);

-- Audit log entries for override actions
CREATE TABLE IF NOT EXISTS override_audit_log (
  id                SERIAL      PRIMARY KEY,
  tenant_id         INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  record_id         TEXT        NOT NULL,
  field_name        TEXT        NOT NULL,
  previous_value    TEXT,       -- NULL for new overrides
  new_value         TEXT        NOT NULL,
  reason            TEXT        NOT NULL,
  action            VARCHAR(32) NOT NULL,  -- 'OVERRIDE_SET' or 'OVERRIDE_REMOVED'
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_override_audit_tenant_actor
  ON override_audit_log(tenant_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_override_audit_record
  ON override_audit_log(record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_override_audit_field
  ON override_audit_log(tenant_id, record_id, field_name);