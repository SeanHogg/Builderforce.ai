-- 0236_quality_error_observability.sql
-- Product Quality / error observability pillar. Ingests errors from any source
-- (our native SDK, OTLP exporters, and Sentry/PostHog/LogRocket webhooks) into a
-- canonical, fingerprint-grouped model — distinct from boardsync's 1:1 task sync.
-- Three tables: connected sources (with a hashed ingest key / encrypted webhook
-- secret), fingerprint-deduped groups, and the raw high-volume event stream.

-- A connected error source. `key_hash` authenticates keyed ingest (native/OTLP);
-- `webhook_secret_enc`/`_iv` (AES-256-GCM, per-tenant) authenticates signed webhooks.
CREATE TABLE IF NOT EXISTS error_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Every source maps to one project: errors group per project and the fix loop
  -- needs one. NOT NULL also keeps the error_groups fingerprint unique workable
  -- (a NULL project_id would make ON CONFLICT treat every event as distinct).
  project_id          integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source              varchar(32) NOT NULL,        -- 'native' | 'otlp' | 'sentry' | 'posthog' | 'logrocket'
  name                varchar(255) NOT NULL,
  key_hash            varchar(64) UNIQUE,          -- SHA-256 of the bfq_* ingest key (shown once)
  webhook_secret_enc  text,                        -- v2:<base64> AES-GCM ciphertext
  webhook_secret_iv   varchar(32),
  enabled             boolean NOT NULL DEFAULT true,
  status              varchar(16) NOT NULL DEFAULT 'active',  -- 'active' | 'paused'
  last_event_at       timestamp,
  created_by          varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_sources_tenant ON error_sources(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_sources_project ON error_sources(project_id);

-- A fingerprint-grouped error. One row per distinct bug; aggregates (event_count,
-- user_count, first/last seen) are bumped on every matching event. `sample_payload`
-- holds the latest event so the dashboard can show a stack trace without scanning
-- error_events. `task_id` links the fix task once "Fix with agent" is invoked.
CREATE TABLE IF NOT EXISTS error_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id       uuid REFERENCES error_sources(id) ON DELETE SET NULL,
  fingerprint     varchar(128) NOT NULL,
  title           varchar(500) NOT NULL,
  type            varchar(255),
  culprit         text,
  level           varchar(16) NOT NULL DEFAULT 'error',   -- 'fatal' | 'error' | 'warning' | 'info'
  status          varchar(16) NOT NULL DEFAULT 'unresolved', -- 'unresolved' | 'resolved' | 'ignored' | 'fixing'
  event_count     integer NOT NULL DEFAULT 0,
  user_count      integer NOT NULL DEFAULT 0,
  first_seen      timestamp NOT NULL DEFAULT now(),
  last_seen       timestamp NOT NULL DEFAULT now(),
  release         varchar(255),
  environment     varchar(64),
  sample_payload  jsonb,
  task_id         integer REFERENCES tasks(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  -- One group per (tenant, project, fingerprint) — the upsert conflict target.
  CONSTRAINT uq_error_groups_fingerprint UNIQUE (tenant_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_tenant_status ON error_groups(tenant_id, project_id, status, last_seen DESC);

-- The raw, high-volume event stream feeding a group. Indexed for per-group trend
-- queries and for the tenant month-to-date sum the consumption meter reads.
CREATE TABLE IF NOT EXISTS error_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ts            timestamp NOT NULL DEFAULT now(),
  release       varchar(255),
  environment   varchar(64),
  user_key      varchar(255),
  payload       jsonb,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_events_group ON error_events(group_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_tenant_created ON error_events(tenant_id, created_at);
