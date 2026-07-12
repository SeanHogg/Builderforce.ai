-- Migration: Add empirical velocity tracking
-- Date: 2026-07-12
-- Description: Store agent sprint history and empirical velocity for capacity calibration

-- Summary table for sprint-level velocity
CREATE TABLE IF NOT EXISTS empirical_velocity (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  sprint_num INTEGER NOT NULL,
  sprint_start_date DATE NOT NULL,
  sprint_end_date DATE NOT NULL,
  story_points_completed INTEGER NOT NULL,
  utilization_hours NUMERIC(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empirical_velocity_tenant_project ON empirical_velocity(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_empirical_velocity_agent ON empirical_velocity(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empirical_velocity_project_agent_sprint 
  ON empirical_velocity(project_id, agent_id, sprint_num, tenant_id);

-- Agent utilization profile (updated from live assignee roster)
CREATE TABLE IF NOT EXISTS agent_utilization_profile (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  current_utilization_percent NUMERIC(5,2) NOT NULL, -- live from assignee roster
  assumed_utilization_percent NUMERIC(5,2), -- legacy 0.4h/SP assumption
  assumed_sp_per_hour NUMERIC(5,3), -- ~2.5 SP per hour @ 0.4h/SP
  accuracy_margin_percent NUMERIC(5,2), -- ±5% target accuracy
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_live_roster_sync TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agent_utilization_profile_tenant_project ON agent_utilization_profile(tenant_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_utilization_profile_project_agent 
  ON agent_utilization_profile(project_id, agent_id, tenant_id);

-- Project-level empirical velocity (aggregate)
CREATE TABLE IF NOT EXISTS project_empirical_velocity (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_sprints INTEGER NOT NULL,
  avg_velocity_sp_per_sprint NUMERIC(6,2),
  min_velocity_sp_per_sprint NUMERIC(6,2),
  max_velocity_sp_per_sprint NUMERIC(6,2),
  velocity_stability_score NUMERIC(3,2) CHECK (velocity_stability_score <= 1.0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_empirical_velocity_project ON project_empirical_velocity(project_id);

-- Validation gap micro-estimation history
CREATE TABLE IF NOT EXISTS validation_gap_estimates (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  task_title VARCHAR(255) NOT NULL,
  task_type VARCHAR(50) NOT NULL, -- task | epic | gap
  micro_sp_estimate INTEGER NOT NULL,
  estimated_range_min_sp INTEGER NOT NULL,
  estimated_range_max_sp INTEGER NOT NULL,
  estimation_method VARCHAR(50) NOT NULL DEFAULT 'micro_estimation', -- micro_estimation | range_median | manual
  assumed_sp_estimate INTEGER, -- legacy assumed
  assumed_range_median_sp INTEGER, -- legacy
  is_micro_estimated BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_gap_estimates_project_task ON validation_gap_estimates(project_id, task_id);
CREATE INDEX IF NOT EXISTS idx_validation_gap_estimates_micro_estimated ON validation_gap_estimates(is_micro_estimated);