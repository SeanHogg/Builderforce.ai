-- Ensure projects has governance and template (idempotent).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS governance text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template varchar(50);
