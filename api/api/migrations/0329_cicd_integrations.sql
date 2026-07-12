-- Migration: CI/CD Pipeline Connectivity & Deploy Data Observability (task #328)
-- 
-- Implements:
-- - CI/CD integration configuration and connection status tracking
-- - Deploy event ingestion, validation, and storage
-- - Ingest receipts and quarantine for failed events
-- - Audit trails for connection state changes
-- - Alerting on integration failures, auth expiry, and data gaps
-- - Per-integration test connection probes
-- 
-- FR-1: Integration Connection Status (webhook or poll telemetry)
-- FR-2: Deploy Data Flow Validation (schema check, receipts, rates)
-- FR-3: Diagnostic Tooling (test connection, inspector, error logs)
-- FR-4: Alerting & Notifications (configurable thresholds, multi-channel)
-- FR-5: Remediation Guidance (setup checklists, inline docs)
-- FR-6: Audit & History (immutable trails, 90-day metrics retention)

-- -------------------------------------------------------------------------
-- CI/CD Integration Configuration Table
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_integrations (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       UUID REFERENCES segments(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  integration_type VARCHAR(50) NOT NULL,  -- github_actions|jenkins|gitlab_ci_cd|circleci|buildkite|azure_devops_pipelines
  connection_config TEXT,  -- JSON: { webhook_url, webhook_secret, token, endpoint, username, scopes, etc. }
  current_status   VARCHAR(30) NOT NULL DEFAULT 'never_configured',  -- connected|degraded|disconnected|never_configured|auth_failed
  last_success_at  TIMESTAMP,
  last_webhook_at  TIMESTAMP,  -- FR-1.4: for webhook-based integrations
  last_payload_hash VARCHAR(255),  -- FR-1.4: hash of last inbound webhook payload
  last_poll_at     TIMESTAMP,   -- FR-1.5: for polling-based integrations
  last_poll_result_count INTEGER,  -- FR-1.5: results from last poll cycle
  auth_failure_code VARCHAR(50),  -- membership reason (expired_token|invalid_secret|insufficient_scopes|not_authorized)
  connection_hint  VARCHAR(255),  -- UI hint string (e.g., "GitHub Actions events received")
  active_webhooks JSONB DEFAULT '[]',  -- list of webhook subscriptions {url, events, secret}
  metadata         JSONB,  -- provider-specific metadata
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_integrations_tenant_segment ON cicd_integrations(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_cicd_integrations_tenant ON cicd_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cicd_integrations_integration_type ON cicd_integrations(integration_type);

DROP TRIGGER IF EXISTS trg_cicd_integrations_segment ON cicd_integrations;
CREATE TRIGGER trg_cicd_integrations_segment BEFORE INSERT ON cicd_integrations FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Deploy Events Table (Canonical schema from PRD FR-2.1)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_deploy_events (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  integration_id  BIGINT NOT NULL REFERENCES cicd_integrations(id) ON DELETE CASCADE,
  event_id        VARCHAR(255) NOT NULL,  -- FR-2.1: canonical deploy event ID (e.g., GitHub Actions workflow_run id)
  
  -- Canonical service interface fields
  service_name    VARCHAR(255) NOT NULL,
  environment     VARCHAR(100) NOT NULL,
  deploy_id       VARCHAR(255) NOT NULL,
  timestamp       TIMESTAMP NOT NULL,
  status          VARCHAR(50) NOT NULL,  -- deployed|failed|cancelled|skipped
  commit_sha      VARCHAR(255) NOT NULL,
  
  -- Ingestion and validation (FR-2.2)
  ingest_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  ingest_receipt_id BIGINT REFERENCES cicd_ingest_receipts(id) ON DELETE SET NULL,
  validation_passed BOOLEAN NOT NULL,
  validation_errors JSONB DEFAULT '[]',  -- list of field-level errors
  
  -- Additional enrichments (optional)
  pr_number        INTEGER,
  triggered_by     VARCHAR(255),
  custom_payload   JSONB,
  metadata         JSONB,
  
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_deploy_events_tenant_segment ON cicd_deploy_events(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_cicd_deploy_events_integration_time ON cicd_deploy_events(integration_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cicd_deploy_events_service_env ON cicd_deploy_events(service_name, environment, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cicd_deploy_events_timestamp ON cicd_deploy_events(timestamp DESC);

DROP TRIGGER IF EXISTS trg_cicd_deploy_events_segment ON cicd_deploy_events;
CREATE TRIGGER trg_cicd_deploy_events_segment BEFORE INSERT ON cicd_deploy_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Ingest Receipts Table (FR-2.2: per-event acknowledgment)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_ingest_receipts (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  event_id       VARCHAR(255) NOT NULL,
  integration_id BIGINT NOT NULL REFERENCES cicd_integrations(id) ON DELETE CASCADE,
  
  receipt_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  status         VARCHAR(30) NOT NULL,  -- accepted|rejected|quarantined
  reason         TEXT,
  errors_json    JSONB DEFAULT '[]',  -- detailed validation errors
  total_errors   INTEGER DEFAULT 0,
  
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_ingest_receipts_tenant ON cicd_ingest_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cicd_ingest_receipts_event ON cicd_ingest_receipts(event_id);
CREATE INDEX IF NOT EXISTS idx_cicd_ingest_receipts_integration ON cicd_ingest_receipts(integration_id);

DROP TRIGGER IF EXISTS trg_cicd_ingest_receipts_segment ON cicd_ingest_receipts;
CREATE TRIGGER trg_cicd_ingest_receipts_segment BEFORE INSERT ON cicd_ingest_receipts FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Quarantine Table (FR-2.5: failed/malformed events persisted >30 days)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_quarantined_events (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  
  original_event JSONB NOT NULL,  -- full payload (schema plus context)
  receipt_id     BIGINT REFERENCES cicd_ingest_receipts(id) ON DELETE SET NULL,
  original_deploy_event_id VARCHAR(255),
  provider       VARCHAR(50) NOT NULL,
  
  validation_errors JSONB NOT NULL,  -- detailed field-level errors
  last_seen_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  retry_count    INTEGER DEFAULT 0,
  last_retry_at  TIMESTAMP,
  
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_quarantined_events_tenant ON cicd_quarantined_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cicd_quarantined_events_last_seen ON cicd_quarantined_events(last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_cicd_quarantined_events_segment ON cicd_quarantined_events;
CREATE TRIGGER trg_cicd_quarantined_events_segment BEFORE INSERT ON cicd_quarantined_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Audit Log for Connection State Changes (FR-6.1)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_integrations_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id   UUID REFERENCES segments(id) ON DELETE CASCADE,
  
  integration_id BIGINT NOT NULL REFERENCES cicd_integrations(id) ON DELETE CASCADE,
  action       VARCHAR(50) NOT NULL,  -- connected|disconnected|auth_expired|configured|updated|deleted
  previous_state VARCHAR(50),
  new_state     VARCHAR(50),
  actor        VARCHAR(255),  -- user_id or 'system'
  metadata     JSONB,  -- context (e.g., trigger_reason, test_result)
  
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_audit_tenant_segment ON cicd_integrations_audit_log(tenant_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_cicd_audit_integration ON cicd_integrations_audit_log(integration_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_cicd_audit_log_segment ON cicd_integrations_audit_log;
CREATE TRIGGER trg_cicd_audit_log_segment BEFORE INSERT ON cicd_integrations_audit_log FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Alert Definitions Table (FR-4.1: configurable thresholds)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_alerts (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  
  integration_id     BIGINT REFERENCES cicd_integrations(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  alert_type         VARCHAR(50) NOT NULL,  -- integration_disconnected|auth_expired|data_gap|high_error_rate
  
  enabled            BOOLEAN NOT NULL DEFAULT true,
  severity           VARCHAR(30) NOT NULL DEFAULT 'medium',  -- critical|high|medium|low
  silence_start      TIMESTAMP,
  silence_end        TIMESTAMP,
  
  -- Thresholds (configurable per alert)
  silence_threshold_hours INTEGER DEFAULT 24,  -- FR-4.1: disconnect before triggering
  error_rate_threshold      DECIMAL(5,2) DEFAULT 5.0,  -- FR-4.1: >5% error rate within 1h
  
  -- Notification channels (JSON: { in_app, email, slack, pagerduty })
  notification_channels JSONB NOT NULL,
  
  last_triggered_at    TIMESTAMP,
  last_resolved_at     TIMESTAMP,
  
  metadata            JSONB,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_alerts_tenant ON cicd_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cicd_alerts_integration ON cicd_alerts(integration_id);
CREATE INDEX IF NOT EXISTS idx_cicd_alerts_enabled ON cicd_alerts(enabled, severity);

DROP TRIGGER IF EXISTS trg_cicd_alerts_segment ON cicd_alerts;
CREATE TRIGGER trg_cicd_alerts_segment BEFORE INSERT ON cicd_alerts FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

-- -------------------------------------------------------------------------
-- Alert History Table (FR-4.3: snooze/long-term tracking)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cicd_alerts_history (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id         UUID REFERENCES segments(id) ON DELETE CASCADE,
  
  alert_id           BIGINT NOT NULL REFERENCES cicd_alerts(id) ON DELETE CASCADE,
  
  triggered_at       TIMESTAMP NOT NULL,
  resolved_at        TIMESTAMP,
  channel_sent_count INTEGER,
  
  metadata           JSONB,  -- context (e.g., specific error codes, data gap stats)
  
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cicd_alerts_history_tenant ON cicd_alerts_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cicd_alerts_history_triggered_at ON cicd_alerts_history(triggered_at DESC);

DROP TRIGGER IF EXISTS trg_cicd_alerts_history_segment ON cicd_alerts_history;
CREATE TRIGGER trg_cicd_alerts_history_segment BEFORE INSERT ON cicd_alerts_history FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();