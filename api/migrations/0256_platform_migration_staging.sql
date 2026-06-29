-- Migration: Platform migration staging + persistent type mapping.
--
-- Adds the "stage before it lands" layer for the Migration / Integration Hub:
-- a customer connects an external tracker (Jira/Monday/Rally/GitLab/Bitbucket),
-- we DISCOVER their projects/types/users, they map+combine them, we STAGE the
-- items, they REVIEW, and only on commit does anything land in projects/tasks.
--
-- All five `import_*` tables are the staging buffer (one import_run = one wizard
-- session, resumable). `board_type_mappings` is the PERSISTENT per-connection
-- external-type → BF task_type/status map consulted by ongoing sync (SyncEngine)
-- so synced tasks stop being hardcoded to backlog/task.
--
-- The integration_provider enum already carries every provider we need
-- (github/gitlab/bitbucket/jira/rally/monday/linear/... — migrations 0064/0074/
-- 0122/0221), so this migration adds NO enum values.

-- ── Persistent per-connection type mapping (drives ongoing sync) ─────────────
CREATE TABLE IF NOT EXISTS board_type_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES board_connections(id) ON DELETE CASCADE,
  external_type   VARCHAR(120) NOT NULL,
  target_task_type VARCHAR(16) NOT NULL DEFAULT 'task',  -- 'task' | 'epic'
  target_status    VARCHAR(64),                          -- freeform BF status lane (null = leave default)
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_board_type_mapping UNIQUE (connection_id, external_type)
);
DROP TRIGGER IF EXISTS trg_board_type_mappings_segment ON board_type_mappings;
CREATE TRIGGER trg_board_type_mappings_segment BEFORE INSERT ON board_type_mappings FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_board_type_mappings_conn ON board_type_mappings(connection_id);

-- ── Migration run (one wizard session) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  provider      VARCHAR(24) NOT NULL,
  credential_id UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  -- 'migrate' = one-time import only · 'sync' = ongoing connection only ·
  -- 'both' = import history AND set up an ongoing sync connection.
  mode          VARCHAR(12) NOT NULL DEFAULT 'migrate',
  -- discovering | staged | mapped | importing | completed | failed | cancelled
  status        VARCHAR(16) NOT NULL DEFAULT 'discovering',
  summary       JSONB,            -- counts {projects, items, users, tasksCreated, connectionsCreated}
  error_message TEXT,
  created_by    VARCHAR(36),      -- users.id of the operator who started the run
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_import_runs_segment ON import_runs;
CREATE TRIGGER trg_import_runs_segment BEFORE INSERT ON import_runs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_import_runs_tenant ON import_runs(tenant_id, created_at);

-- ── Discovered external projects (mapping/combine target lives here) ──────────
CREATE TABLE IF NOT EXISTS import_staged_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id         VARCHAR(255) NOT NULL,
  external_key        VARCHAR(120),
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  external_url        VARCHAR(500),
  item_count          INTEGER,
  -- 'create' = make a new BF project · 'map' = fold into target_project_id
  -- (several staged projects sharing one target_project_id = COMBINE) · 'skip'.
  action              VARCHAR(8) NOT NULL DEFAULT 'create',
  target_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  target_project_name VARCHAR(255),
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_import_staged_project UNIQUE (run_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_import_staged_projects_run ON import_staged_projects(run_id);

-- ── Discovered/staged items (the data the user reviews before it lands) ───────
CREATE TABLE IF NOT EXISTS import_staged_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staged_project_id UUID NOT NULL REFERENCES import_staged_projects(id) ON DELETE CASCADE,
  external_id       VARCHAR(255) NOT NULL,
  external_type     VARCHAR(120),
  external_url      VARCHAR(500),
  title             TEXT NOT NULL,
  body              TEXT,
  state             VARCHAR(120),
  story_points      REAL,
  raw               JSONB,
  target_task_type  VARCHAR(16) NOT NULL DEFAULT 'task',
  target_status     VARCHAR(64) NOT NULL DEFAULT 'backlog',
  include           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_import_staged_item UNIQUE (run_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_import_staged_items_run ON import_staged_items(run_id);
CREATE INDEX IF NOT EXISTS idx_import_staged_items_project ON import_staged_items(staged_project_id);

-- ── External type → BF task_type/status mapping for THIS run (seeds the connection map) ──
CREATE TABLE IF NOT EXISTS import_type_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_type    VARCHAR(120) NOT NULL,
  target_task_type VARCHAR(16) NOT NULL DEFAULT 'task',
  target_status    VARCHAR(64) NOT NULL DEFAULT 'backlog',
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_import_type_mapping UNIQUE (run_id, external_type)
);
CREATE INDEX IF NOT EXISTS idx_import_type_mappings_run ON import_type_mappings(run_id);

-- ── Discovered external users (merge/consolidate target lives here) ───────────
CREATE TABLE IF NOT EXISTS import_staged_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id    VARCHAR(255) NOT NULL,
  display_name   VARCHAR(255),
  email          VARCHAR(320),
  -- 'invite' = send a workspace invite · 'map' = link to target_user_id · 'skip'.
  action         VARCHAR(8) NOT NULL DEFAULT 'invite',
  target_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_import_staged_user UNIQUE (run_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_import_staged_users_run ON import_staged_users(run_id);
