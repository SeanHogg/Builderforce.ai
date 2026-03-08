-- Add capabilities column to coderclaw_instances
-- Stores a JSON array of capability strings reported by each claw on heartbeat
-- e.g. '["chat","tasks","relay","remote-dispatch"]'
ALTER TABLE coderclaw_instances ADD COLUMN IF NOT EXISTS capabilities text;
