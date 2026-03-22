-- Add local_personas column to coderclaw_instances
-- Stores the claw's custom agent role definitions as a JSON array
ALTER TABLE coderclaw_instances ADD COLUMN IF NOT EXISTS local_personas text;
