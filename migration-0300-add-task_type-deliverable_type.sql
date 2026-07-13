-- Migration 0300: Add task_type and deliverable_type columns to tasks table
--
-- This migration adds two new columns to support the PRD task taxonomy:
-- 1. task_type: Enum-like field for detailed task categorization
--    - coding, analysis, provisioning, decision, documentation (security-agnostic task types)
--    - Legacy task types (task, epic, gap, security, incident, product, design) continue to exist for backward compatibility
--
-- 2. deliverable_type: High-level deliverable classification (orthogonal to task_type)
--    - code, decision, spec, ops (used by the completion gate)
--
-- Both columns are nullable to allow gradual migration. Tasks without these values default to
-- sensible defaults based on the existing legacy task_type for gating.
--
-- Affected Table: tasks
-- New Columns:
--   task_type VARCHAR(50)  -- Per PRD #615 new taxonomy
--   deliverable_type VARCHAR(20) -- High-level deliverable classification used by gate

-- Create enum for new task_type values
CREATE TYPE prd_task_type AS ENUM (
    'coding',          -- Implementation-driven work, cannot complete without code
    'analysis',        -- Research spikes, architectural investigation, documentation deliverable OK
    'provisioning',    -- Infra setup, config changes, deliverable OK (not code)
    'decision',        -- Formal written decision/ADR, deliverable OK
    'documentation'    -- Pure doc work scoped explicitly, deliverable OK
);

-- Create enum for deliverable_type values
CREATE TYPE deliverable_type AS ENUM (
    'code',            -- Feature/bug-fix/refactor/test suite, requires impl
    'decision',        -- Written decision or analysis, doc PR OK
    'spec',            -- PRD/design doc, doc PR OK
    'ops'              -- Infra provisioning, CI config, evaluated per task
);

-- Add new columns to tasks table (nullable for gradual migration)
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS deliverable_type deliverable_type DEFAULT 'code',
    ADD COLUMN IF NOT EXISTS task_type prd_task_type;

-- Backfill task_type based on legacy kind for existing tasks
-- This ensures the gate has meaningful data for tasks migrated after PRD adoption
UPDATE tasks SET
    task_type = 
        CASE
            WHEN task_type = 'task' THEN 'coding'
            WHEN task_type = 'epic' THEN 'analysis'  -- Epics are planning containers
            WHEN task_type = 'gap' THEN 'analysis'   -- Gaps are discovery work
            WHEN task_type = 'security' THEN 'decision'  -- Security findings are documented
            WHEN task_type = 'incident' THEN 'decision'
            WHEN task_type = 'product' THEN 'decision'
            WHEN task_type = 'design' THEN 'analysis'
            ELSE NULL  -- Leave NULL for tasks without clear legacy mapping
        END
    WHERE task_type IS NULL;

-- Backfill deliverable_type based on task_type (PRD FR-5b)
-- The gate uses deliverable_type as the primary classification for FR-6 gate logic
UPDATE tasks SET
    deliverable_type =
        CASE
            WHEN task_type = 'coding' OR task_type = 'analysis' THEN 'code'
            WHEN task_type = 'provisioning' THEN 'ops'
            WHEN task_type = 'decision' THEN 'decision'
            WHEN task_type = 'documentation' THEN 'decision'  -- Documentation delivers decision/spec insight
            ELSE 'code'  -- Fallback for unexpected task_type values
        END
    WHERE deliverable_type IS NULL;

-- Index for queries filtering by task_type and deliverable_type
CREATE INDEX IF NOT EXISTS tasks_task_type_idx ON tasks(task_type);
CREATE INDEX IF NOT EXISTS tasks_deliverable_type_idx ON tasks(deliverable_type);
CREATE INDEX IF NOT EXISTS tasks_deliverable_type_task_type_compound_idx 
    ON tasks(deliverable_type, task_type);

-- Add comment on columns for documentation
COMMENT ON COLUMN tasks.task_type IS 'PRD #615 task taxonomy: coding, analysis, provisioning, decision, documentation (nullable, backfilled from legacy task_type)';
COMMENT ON COLUMN tasks.deliverable_type IS 'PRD #615 high-level deliverable classification used by completion gate: code, decision, spec, ops';

-- Add trigger to auto-derive deliverable_type from task_type on insert/update if not set
CREATE OR REPLACE FUNCTION derive_deliverable_type()
RETURNS trigger AS $$
BEGIN
    IF NEW.deliverable_type IS NULL THEN
        NEW.deliverable_type := CASE
            WHEN NEW.task_type = 'coding' THEN 'code'
            WHEN NEW.task_type = 'analysis' THEN 'code'
            WHEN NEW.task_type = 'provisioning' THEN 'ops'
            WHEN NEW.task_type = 'decision' THEN 'decision'
            WHEN NEW.task_type = 'documentation' THEN 'decision'
            ELSE 'code'  -- Default for unexpected task_type values
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS derive_deliverable_type_trigger ON tasks;
CREATE TRIGGER derive_deliverable_type_trigger
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION derive_deliverable_type();

-- Migration notes:
-- - The new columns allow gradual migration; existing data is backfilled consistently
-- - The gate implementation (ProgressGate.ts) will use task_type/null for defaults if DB column is NULL
-- - This migration is non-destructive; existing tasks retain their legacy behavior through deliverable_type