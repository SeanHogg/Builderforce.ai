-- Promote `creation_sessions.folder` from a free-text string to a real entity.
--
-- A folder used to be a `varchar` copied verbatim onto every session in it —
-- no identity, no rename-all, and nothing to hang a Project association off
-- of. `creation_session_project_links` already reasons about this exact
-- mistake in its own doc comment ("storing it twice is two facts free to
-- disagree"): the fix here is the same one, applied to folder.

CREATE TABLE IF NOT EXISTS creation_session_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES segments(id) ON DELETE CASCADE,
  name       varchar(120) NOT NULL,
  -- Optional: this folder (and every session filed into it) belongs to a
  -- Project. NULL = an unscoped folder, same as an unfoldered session today.
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_creation_session_folders_name
  ON creation_session_folders (tenant_id, segment_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_creation_session_folders_project
  ON creation_session_folders (project_id, created_at);

-- Backfill one folder row per distinct (tenant, segment, folder name) that
-- exists today.
INSERT INTO creation_session_folders (tenant_id, segment_id, name, created_at)
SELECT DISTINCT tenant_id, segment_id, folder, now()
FROM creation_sessions
WHERE folder IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE creation_sessions ADD COLUMN IF NOT EXISTS folder_id uuid
  REFERENCES creation_session_folders(id) ON DELETE SET NULL;

UPDATE creation_sessions cs
SET folder_id = f.id
FROM creation_session_folders f
WHERE cs.folder IS NOT NULL
  AND f.tenant_id = cs.tenant_id
  AND f.segment_id IS NOT DISTINCT FROM cs.segment_id
  AND f.name = cs.folder
  AND cs.folder_id IS NULL;

DROP INDEX IF EXISTS idx_creation_sessions_tenant_folder;

ALTER TABLE creation_sessions DROP COLUMN IF EXISTS folder;

CREATE INDEX IF NOT EXISTS idx_creation_sessions_tenant_folder
  ON creation_sessions (tenant_id, segment_id, folder_id, last_activity_at);
