-- Optional user-facing organization for creation sessions. A folder is stored
-- on the session so rename/move remains atomic and existing sessions stay unfiled.
ALTER TABLE creation_sessions
  ADD COLUMN IF NOT EXISTS folder VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_creation_sessions_tenant_folder
  ON creation_sessions(tenant_id, segment_id, folder, last_activity_at DESC);
