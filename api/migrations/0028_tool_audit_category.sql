-- Add category column to tool_audit_events if missing.
-- Some deployments may have created the table before category was in the schema.
ALTER TABLE tool_audit_events
  ADD COLUMN IF NOT EXISTS category varchar(100);
