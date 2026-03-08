-- Migration: add columns missing from tasks and coderclaw_instances tables
-- Run this in the Neon SQL editor or via: NEON_DATABASE_URL=... pnpm db:push

-- Tasks: add scheduling, persona, and archive columns
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date  timestamp;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date    timestamp;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS persona     varchar(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived    boolean NOT NULL DEFAULT false;

-- CoderClaw instances: track live WebSocket upstream connections
ALTER TABLE coderclaw_instances ADD COLUMN IF NOT EXISTS connected_at timestamp;
