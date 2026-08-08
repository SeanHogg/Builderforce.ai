-- Dependency Resolution Enhancement
-- Migration 0332: Add tables for tracking dependency resolution history and critical path cache

-- Resolution history table: tracks previously resolved blockers
CREATE TABLE IF NOT EXISTS dependency_resolution_history (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocker_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  impacted_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  dependency_path TEXT[] NOT NULL,  -- Array of task IDs in the critical path
  solution_effort_minutes INTEGER NOT NULL,  -- Estimated time to unblock
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),
  resolution_duration_minutes INTEGER,  -- Actual time from detection to resolution
  resolved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  notes TEXT
);

-- Critical path cache: stores computed critical paths for reuse
CREATE TABLE IF NOT EXISTS critical_path_cache (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  critical_path TEXT[] NOT NULL,  -- Array of task IDs in order
  total_duration_days FLOAT NOT NULL,  -- Total duration in days
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  depends_on_cards_change BOOLEAN NOT NULL DEFAULT FALSE,  -- Recalculate when dependent task changes
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_resolution_history_task_id ON dependency_resolution_history(task_id);
CREATE INDEX IF NOT EXISTS idx_resolution_history_resolved_at ON dependency_resolution_history(resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_critical_path_cache_project_id ON critical_path_cache(project_id);
CREATE INDEX IF NOT EXISTS idx_critical_path_cache_task_id ON critical_path_cache(task_id);