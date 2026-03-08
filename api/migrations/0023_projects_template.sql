-- Add template column to projects for IDE use (e.g. "vanilla" to seed initial files).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template VARCHAR(50);
