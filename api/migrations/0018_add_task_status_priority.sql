-- Migration: 0018_add_task_status_priority
-- Add new task statuses (backlog, ready) and an urgent priority.

DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'backlog';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'ready';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE task_priority ADD VALUE IF NOT EXISTS 'urgent';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- adjust default on existing tasks table
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'backlog';

-- P: add governance column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS governance text;
