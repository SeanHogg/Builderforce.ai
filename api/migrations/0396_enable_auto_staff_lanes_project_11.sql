-- 0396 — Enable allowAutoStaffLanes for Project 11
--
-- Task #1534: Enable auto-staffing on Project 11's unconfigured lanes
--
-- Problem: 193 tickets in Project 11 are stalled with status `lane_unconfigured` 
-- because their board lanes have no declared required role and no staffed agent.
-- The manager's `allowAutoStaffLanes` is currently false, preventing self-healing.
--
-- Solution: Enable allowAutoStaffLanes for Project 11 so the manager can 
-- automatically assign available agents to those lanes, unblocking the largest 
-- cohort of stalled tickets in the project.

-- First, ensure project_manager_configs row exists for project 11
INSERT INTO project_manager_configs (id, tenant_id, project_id, allow_auto_staff_lanes, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  (SELECT tenant_id FROM projects WHERE id = 11 LIMIT 1),
  11,
  true,  -- enable auto-staffing
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM project_manager_configs WHERE project_id = 11
);

-- If row already exists, update it
UPDATE project_manager_configs
SET allow_auto_staff_lanes = true, updated_at = now()
WHERE project_id = 11 AND (allow_auto_staff_lanes IS NULL OR allow_auto_staff_lanes = false);
