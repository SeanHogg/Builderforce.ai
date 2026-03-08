-- Create claw workspace tables: project associations, synced directory manifest, and directory files.
-- All CREATE TABLE statements use IF NOT EXISTS so the migration is idempotent.

CREATE TABLE IF NOT EXISTS claw_projects (
  id         serial,
  tenant_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id    integer NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, claw_id, project_id)
);

CREATE INDEX IF NOT EXISTS claw_projects_claw_idx ON claw_projects (claw_id);

CREATE TABLE IF NOT EXISTS claw_directories (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id        integer NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  project_id     integer REFERENCES projects(id) ON DELETE SET NULL,
  abs_path       text NOT NULL,
  path_hash      varchar(128) NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'pending',
  metadata       text,
  error_message  text,
  last_seen_at   timestamp,
  last_synced_at timestamp,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, claw_id, path_hash)
);

CREATE INDEX IF NOT EXISTS claw_directories_claw_idx ON claw_directories (claw_id);

CREATE TABLE IF NOT EXISTS claw_directory_files (
  id           serial,
  tenant_id    integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id      integer NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  directory_id integer NOT NULL REFERENCES claw_directories(id) ON DELETE CASCADE,
  rel_path     text NOT NULL,
  content_hash varchar(128) NOT NULL,
  size_bytes   integer NOT NULL DEFAULT 0,
  content      text,
  updated_at   timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (directory_id, rel_path)
);

CREATE INDEX IF NOT EXISTS claw_directory_files_claw_idx ON claw_directory_files (claw_id);
