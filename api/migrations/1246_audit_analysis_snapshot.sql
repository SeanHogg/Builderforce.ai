-- Persist analyzer artifacts before report/ticket completion so retries retain the same measurement.
ALTER TABLE system_audit_runs ADD COLUMN IF NOT EXISTS analysis JSONB;
