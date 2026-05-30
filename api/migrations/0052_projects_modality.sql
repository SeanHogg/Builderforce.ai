-- 0052_projects_modality.sql
-- Mirror the worker-side `modality` column onto the Drizzle/Neon `projects` table
-- so the IDE's project modality (designer | video | llm) persists on the API-only
-- deployment path (NEXT_PUBLIC_WORKER_URL unset), matching worker/schema.sql.
-- See README "Consolidated Gap Register".

ALTER TABLE projects ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'designer';
