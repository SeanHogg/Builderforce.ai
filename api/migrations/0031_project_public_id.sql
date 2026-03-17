-- Add public UUID for projects so that URL IDs are non-guessable.
-- Existing rows get a random UUID automatically via gen_random_uuid().
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS projects_public_id_idx ON projects (public_id);
