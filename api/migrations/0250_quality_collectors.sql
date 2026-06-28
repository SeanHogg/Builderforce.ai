-- 0250_quality_collectors.sql
-- Rework the Quality config model: a PROJECT is the unit of error gathering with
-- exactly ONE collector (one ingest key = one embeddable snippet) that ingests
-- from all the project's repos and every channel (native SDK, OTLP, and provider
-- webhooks). A TENANT-level collector (project_id NULL) ingests a mixed stream and
-- routes each event to a project via error_mapping_rules. Supersedes the previous
-- per-source-type `error_sources` rows.

-- error_sources → error_collectors (a collector is multi-source, not one type).
ALTER TABLE error_sources RENAME TO error_collectors;
-- project_id NULL = tenant-level collector (needs mapping rules); NOT NULL = project collector.
ALTER TABLE error_collectors ALTER COLUMN project_id DROP NOT NULL;
-- A collector is no longer tied to one source type; the webhook secret moves to
-- per-provider integrations.
ALTER TABLE error_collectors DROP COLUMN IF EXISTS source;
ALTER TABLE error_collectors DROP COLUMN IF EXISTS webhook_secret_enc;
ALTER TABLE error_collectors DROP COLUMN IF EXISTS webhook_secret_iv;
-- Fallback project for a tenant-level collector when no mapping rule matches.
ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS default_project_id integer REFERENCES projects(id) ON DELETE SET NULL;
-- Exactly one collector per project (tenant-level collectors have NULL project_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_error_collectors_project ON error_collectors(tenant_id, project_id) WHERE project_id IS NOT NULL;

-- error_groups.source_id → collector_id (the FK target followed the table rename).
ALTER TABLE error_groups RENAME COLUMN source_id TO collector_id;

-- Provider webhook integrations attached to a collector (Sentry/PostHog/LogRocket).
-- `secret_enc`/`secret_iv` (AES-256-GCM per-tenant) seal {secret?, apiToken?, scope?, baseUrl?}.
CREATE TABLE IF NOT EXISTS error_collector_integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id  uuid NOT NULL REFERENCES error_collectors(id) ON DELETE CASCADE,
  provider      varchar(32) NOT NULL,   -- 'sentry' | 'posthog' | 'logrocket'
  secret_enc    text,
  secret_iv     varchar(32),
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_collector_provider UNIQUE (collector_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_error_collector_integrations_collector ON error_collector_integrations(collector_id);

-- Error-mapping rules for a tenant-level collector → route an event to a project.
-- match_field: 'service' | 'release' | 'environment' | 'url' | 'tag:<key>'.
-- match_op: 'equals' | 'contains' | 'prefix'. First matching rule (by priority) wins.
CREATE TABLE IF NOT EXISTS error_mapping_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collector_id  uuid NOT NULL REFERENCES error_collectors(id) ON DELETE CASCADE,
  match_field   varchar(64) NOT NULL,
  match_op      varchar(16) NOT NULL DEFAULT 'equals',
  match_value   varchar(255) NOT NULL,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  priority      integer NOT NULL DEFAULT 100,
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_mapping_rules_collector ON error_mapping_rules(collector_id, priority);
