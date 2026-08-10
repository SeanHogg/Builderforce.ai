-- 0418_kernel_primitives.sql
--
-- Kernel primitives
--
-- GENERATED from src/infrastructure/database/schema/kernel.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 24 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER,
  kind VARCHAR(64) NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  domain VARCHAR(32) NOT NULL DEFAULT 'platform',
  title VARCHAR(300),
  parent_id UUID,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_objects_ref ON objects (tenant_id, kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_objects_tenant_kind ON objects (tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_objects_tenant_touched ON objects (tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_objects_parent ON objects (parent_id);
CREATE INDEX IF NOT EXISTS idx_objects_domain ON objects (tenant_id, domain, updated_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  account_kind VARCHAR(24) NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  denomination VARCHAR(32) NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  balance_after NUMERIC(20, 6),
  entry_kind VARCHAR(24) NOT NULL,
  reference VARCHAR(160),
  memo TEXT,
  metadata JSONB,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_reference ON ledger_entries (tenant_id, denomination, reference);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (tenant_id, account_kind, account_ref, denomination, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_object ON ledger_entries (object_id);

CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  user_id VARCHAR(64),
  vendor VARCHAR(64) NOT NULL,
  capability VARCHAR(32) NOT NULL,
  external_account VARCHAR(320) NOT NULL DEFAULT '',
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'connected',
  scope TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  last_synced_at TIMESTAMP,
  cache_version INTEGER NOT NULL DEFAULT 1,
  config JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_account ON connections (tenant_id, user_id, vendor, capability, external_account);
CREATE INDEX IF NOT EXISTS idx_connections_tenant ON connections (tenant_id, capability, status);

CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL DEFAULT 'oauth',
  secret_enc TEXT NOT NULL,
  secret_iv VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP,
  rotated_at TIMESTAMP,
  last_used_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_purpose ON credentials (tenant_id, connection_id, purpose);
CREATE INDEX IF NOT EXISTS idx_credentials_expiry ON credentials (status, expires_at);

CREATE TABLE IF NOT EXISTS sync_states (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
  resource VARCHAR(96) NOT NULL,
  cursor TEXT,
  checkpoint JSONB,
  last_run_at TIMESTAMP,
  last_success_at TIMESTAMP,
  last_error TEXT,
  records_seen BIGINT NOT NULL DEFAULT 0,
  records_written BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'idle',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_states_resource ON sync_states (tenant_id, connection_id, resource);

CREATE TABLE IF NOT EXISTS memberships (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  member_kind VARCHAR(16) NOT NULL,
  member_ref VARCHAR(320) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  state VARCHAR(16) NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_member ON memberships (tenant_id, object_id, member_kind, member_ref);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships (tenant_id, member_kind, member_ref, state);
CREATE INDEX IF NOT EXISTS idx_memberships_object ON memberships (object_id, state);

CREATE TABLE IF NOT EXISTS annotations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  parent_id BIGINT,
  kind VARCHAR(16) NOT NULL DEFAULT 'comment',
  author_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  author_ref VARCHAR(64),
  author_name VARCHAR(255),
  body TEXT,
  value NUMERIC(10, 2),
  label VARCHAR(120),
  anchor JSONB,
  resolved_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_annotations_object ON annotations (object_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_annotations_author ON annotations (tenant_id, author_ref);
CREATE INDEX IF NOT EXISTS idx_annotations_parent ON annotations (parent_id);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  scope VARCHAR(16) NOT NULL DEFAULT 'view',
  password_hash VARCHAR(128),
  expires_at TIMESTAMP,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_share_links_object ON share_links (object_id);
CREATE INDEX IF NOT EXISTS idx_share_links_tenant ON share_links (tenant_id, revoked_at);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  email VARCHAR(320),
  invitee_ref VARCHAR(64),
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  message TEXT,
  invited_by VARCHAR(64),
  expires_at TIMESTAMP,
  accepted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations (tenant_id, email, state);
CREATE INDEX IF NOT EXISTS idx_invitations_object ON invitations (object_id, state);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'tenant',
  scope_ref VARCHAR(64) NOT NULL DEFAULT '',
  feature VARCHAR(64) NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_scope ON settings (tenant_id, scope, scope_ref, feature);

CREATE TABLE IF NOT EXISTS relations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  from_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  attrs JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_relations_edge ON relations (tenant_id, from_id, to_id, kind);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (from_id, kind, position);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (to_id, kind);

CREATE TABLE IF NOT EXISTS party_roles (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  party_kind VARCHAR(16) NOT NULL DEFAULT 'person',
  party_ref VARCHAR(64) NOT NULL,
  role VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  attrs JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_roles_role ON party_roles (tenant_id, party_kind, party_ref, role);
CREATE INDEX IF NOT EXISTS idx_party_roles_role ON party_roles (tenant_id, role, status);

CREATE TABLE IF NOT EXISTS work_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL DEFAULT 'task',
  parent_id BIGINT,
  project_ref VARCHAR(64),
  title VARCHAR(300) NOT NULL,
  body TEXT,
  status VARCHAR(48) NOT NULL DEFAULT 'todo',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  assignee_kind VARCHAR(16),
  assignee_ref VARCHAR(64),
  start_at TIMESTAMP,
  due_at TIMESTAMP,
  completed_at TIMESTAMP,
  progress NUMERIC(5, 2) NOT NULL DEFAULT '0',
  target_value NUMERIC(20, 4),
  current_value NUMERIC(20, 4),
  attrs JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_items_board ON work_items (tenant_id, project_ref, kind, status, position);
CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items (parent_id);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON work_items (tenant_id, assignee_kind, assignee_ref, status);
CREATE INDEX IF NOT EXISTS idx_work_items_object ON work_items (object_id);

CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  kind VARCHAR(48) NOT NULL,
  parent_run_id BIGINT,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 1,
  queued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  input JSONB,
  output JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_status ON runs (tenant_id, kind, status, queued_at);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs (parent_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_object ON runs (object_id);

CREATE TABLE IF NOT EXISTS metric_facts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  metric VARCHAR(96) NOT NULL,
  bucket VARCHAR(16) NOT NULL DEFAULT 'day',
  bucket_at TIMESTAMP NOT NULL,
  dimension JSONB,
  dimension_key VARCHAR(200) NOT NULL DEFAULT '',
  value NUMERIC(24, 6) NOT NULL,
  unit VARCHAR(24),
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_facts_point ON metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key);
CREATE INDEX IF NOT EXISTS idx_metric_facts_series ON metric_facts (tenant_id, metric, bucket_at);
CREATE INDEX IF NOT EXISTS idx_metric_facts_object ON metric_facts (object_id, metric, bucket_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  title VARCHAR(300) NOT NULL DEFAULT '',
  mime VARCHAR(128),
  storage_key TEXT,
  byte_size BIGINT,
  checksum VARCHAR(128),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  language VARCHAR(16),
  status VARCHAR(16) NOT NULL DEFAULT 'ready',
  derived_from_id UUID,
  attrs JSONB,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_artifacts_object ON artifacts (object_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_tenant_kind ON artifacts (tenant_id, kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_derived ON artifacts (derived_from_id, kind);

CREATE TABLE IF NOT EXISTS revisions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  label VARCHAR(120),
  author_ref VARCHAR(64),
  summary TEXT,
  patch JSONB,
  snapshot_key TEXT,
  byte_size BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_revisions_version ON revisions (tenant_id, object_id, version);
CREATE INDEX IF NOT EXISTS idx_revisions_object ON revisions (object_id, version);

CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  reason VARCHAR(48) NOT NULL,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  storage_key TEXT,
  payload JSONB,
  byte_size BIGINT,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_object ON snapshots (object_id, taken_at);

CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER,
  kind VARCHAR(32) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  name VARCHAR(200) NOT NULL,
  summary TEXT,
  body JSONB,
  category VARCHAR(64),
  tags JSONB,
  version VARCHAR(24) NOT NULL DEFAULT '1.0.0',
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  price_cents INTEGER,
  currency VARCHAR(8),
  publisher_ref VARCHAR(64),
  install_count INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(3, 2),
  is_template BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_items_slug ON catalog_items (tenant_id, kind, slug);
CREATE INDEX IF NOT EXISTS idx_catalog_items_public ON catalog_items (kind, visibility, published_at);

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL DEFAULT 'chat',
  title VARCHAR(300),
  mode VARCHAR(16) NOT NULL DEFAULT 'chat',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_threads_tenant_recent ON threads (tenant_id, kind, last_message_at);
CREATE INDEX IF NOT EXISTS idx_threads_object ON threads (object_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  author_ref VARCHAR(64),
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  body TEXT,
  parts JSONB,
  token_count INTEGER,
  model VARCHAR(96),
  reply_to_id BIGINT,
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  kind VARCHAR(32) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  questions JSONB NOT NULL DEFAULT '[]',
  cadence JSONB,
  audience JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  opens_at TIMESTAMP,
  closes_at TIMESTAMP,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_question_sets_tenant ON question_sets (tenant_id, kind, status);

CREATE TABLE IF NOT EXISTS responses (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  question_set_id UUID REFERENCES question_sets(id) ON DELETE CASCADE,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  respondent_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  respondent_ref VARCHAR(64),
  question_key VARCHAR(120) NOT NULL,
  value_text TEXT,
  value_number NUMERIC(20, 6),
  value_json JSONB,
  submitted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_responses_set ON responses (question_set_id, question_key);
CREATE INDEX IF NOT EXISTS idx_responses_object ON responses (object_id);
CREATE INDEX IF NOT EXISTS idx_responses_respondent ON responses (tenant_id, respondent_kind, respondent_ref);

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  channel VARCHAR(24) NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  template VARCHAR(96),
  subject VARCHAR(300),
  payload JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  retryable BOOLEAN NOT NULL DEFAULT true,
  provider VARCHAR(48),
  provider_ref VARCHAR(160),
  error TEXT,
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_queue ON deliveries (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant ON deliveries (tenant_id, channel, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_object ON deliveries (object_id);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE objects DROP CONSTRAINT IF EXISTS fk_objects_tenant;
ALTER TABLE objects ADD CONSTRAINT fk_objects_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS fk_ledger_entries_tenant;
ALTER TABLE ledger_entries ADD CONSTRAINT fk_ledger_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE connections DROP CONSTRAINT IF EXISTS fk_connections_tenant;
ALTER TABLE connections ADD CONSTRAINT fk_connections_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE credentials DROP CONSTRAINT IF EXISTS fk_credentials_tenant;
ALTER TABLE credentials ADD CONSTRAINT fk_credentials_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sync_states DROP CONSTRAINT IF EXISTS fk_sync_states_tenant;
ALTER TABLE sync_states ADD CONSTRAINT fk_sync_states_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS fk_memberships_tenant;
ALTER TABLE memberships ADD CONSTRAINT fk_memberships_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE annotations DROP CONSTRAINT IF EXISTS fk_annotations_tenant;
ALTER TABLE annotations ADD CONSTRAINT fk_annotations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE share_links DROP CONSTRAINT IF EXISTS fk_share_links_tenant;
ALTER TABLE share_links ADD CONSTRAINT fk_share_links_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS fk_invitations_tenant;
ALTER TABLE invitations ADD CONSTRAINT fk_invitations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE settings DROP CONSTRAINT IF EXISTS fk_settings_tenant;
ALTER TABLE settings ADD CONSTRAINT fk_settings_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE relations DROP CONSTRAINT IF EXISTS fk_relations_tenant;
ALTER TABLE relations ADD CONSTRAINT fk_relations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE party_roles DROP CONSTRAINT IF EXISTS fk_party_roles_tenant;
ALTER TABLE party_roles ADD CONSTRAINT fk_party_roles_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS fk_work_items_tenant;
ALTER TABLE work_items ADD CONSTRAINT fk_work_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS fk_runs_tenant;
ALTER TABLE runs ADD CONSTRAINT fk_runs_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE metric_facts DROP CONSTRAINT IF EXISTS fk_metric_facts_tenant;
ALTER TABLE metric_facts ADD CONSTRAINT fk_metric_facts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS fk_artifacts_tenant;
ALTER TABLE artifacts ADD CONSTRAINT fk_artifacts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE revisions DROP CONSTRAINT IF EXISTS fk_revisions_tenant;
ALTER TABLE revisions ADD CONSTRAINT fk_revisions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS fk_snapshots_tenant;
ALTER TABLE snapshots ADD CONSTRAINT fk_snapshots_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE catalog_items DROP CONSTRAINT IF EXISTS fk_catalog_items_tenant;
ALTER TABLE catalog_items ADD CONSTRAINT fk_catalog_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE threads DROP CONSTRAINT IF EXISTS fk_threads_tenant;
ALTER TABLE threads ADD CONSTRAINT fk_threads_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_tenant;
ALTER TABLE messages ADD CONSTRAINT fk_messages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE question_sets DROP CONSTRAINT IF EXISTS fk_question_sets_tenant;
ALTER TABLE question_sets ADD CONSTRAINT fk_question_sets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE responses DROP CONSTRAINT IF EXISTS fk_responses_tenant;
ALTER TABLE responses ADD CONSTRAINT fk_responses_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS fk_deliveries_tenant;
ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Kernel extras — the statements the DDL generator cannot derive.
--
-- 1. Self-referencing foreign keys. Drizzle needs an explicit type annotation to
--    let a table reference itself, which the lexical parser in ddlFromDrizzle.mjs
--    will not read. The constraint belongs in the database regardless, and this
--    is where it goes.
-- 2. `activity_log` already had a CREATE TABLE (migration 0287, single audit
--    store since 0295), so its new registry column arrives as an ADD COLUMN.

ALTER TABLE objects DROP CONSTRAINT IF EXISTS fk_objects_parent;
ALTER TABLE objects ADD CONSTRAINT fk_objects_parent
  FOREIGN KEY (parent_id) REFERENCES objects(id) ON DELETE CASCADE;

ALTER TABLE annotations DROP CONSTRAINT IF EXISTS fk_annotations_parent;
ALTER TABLE annotations ADD CONSTRAINT fk_annotations_parent
  FOREIGN KEY (parent_id) REFERENCES annotations(id) ON DELETE CASCADE;

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS fk_work_items_parent;
ALTER TABLE work_items ADD CONSTRAINT fk_work_items_parent
  FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS fk_runs_parent;
ALTER TABLE runs ADD CONSTRAINT fk_runs_parent
  FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE CASCADE;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS fk_artifacts_derived_from;
ALTER TABLE artifacts ADD CONSTRAINT fk_artifacts_derived_from
  FOREIGN KEY (derived_from_id) REFERENCES artifacts(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_reply_to;
ALTER TABLE messages ADD CONSTRAINT fk_messages_reply_to
  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;

-- The registry reference the (target_type, target_id) pair could never enforce.
-- `activity_log` predates the kernel (migration 0287) and is declared on BOTH
-- tracks, so the column is added on both: here with a real foreign key into
-- `objects`, and in transactional-migrations/0004 without one, because the
-- operational database has no `objects` table to point at. Nullable either way —
-- rows written before their target was registered keep the (target_type,
-- target_id) pair only.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS object_id UUID;
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS fk_activity_log_object;
ALTER TABLE activity_log ADD CONSTRAINT fk_activity_log_object
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_activity_log_object ON activity_log (object_id, occurred_at);
