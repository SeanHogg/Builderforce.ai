-- 0337_workflow_event_triggers.sql
-- Reliability × Workflows: let internal domain events fire custom workflows, and let
-- an incident run a workflow as a runbook.
--
-- No new tables — event triggers reuse the existing `workflow_triggers` registry
-- (trigger_type gains monitor-breach | incident-created | incident-resolved |
-- incident-status-change; they carry no token / next_run_at and are fired
-- synchronously by fireEventTriggers when the emitting service raises the event).
--
-- This migration only adds the run→source linkage so the incident detail can list
-- "workflows run for this incident": a run instantiated by an incident/monitor event
-- (or a manual runbook launched from an incident) stamps the originating id.
--
-- Plain UUID columns (no FK) — mirrors monitors.current_incident_id / monitor_events
-- .incident_id: the incident/monitor may be a different lifecycle owner and we never
-- want a workflow-run insert to fail on a missing/cleaned-up parent; queries filter by
-- equality only. Indexed for the per-incident lookup.

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS source_incident_id UUID,
  ADD COLUMN IF NOT EXISTS source_monitor_id  UUID;

CREATE INDEX IF NOT EXISTS idx_workflows_source_incident ON workflows(source_incident_id);
CREATE INDEX IF NOT EXISTS idx_workflows_source_monitor  ON workflows(source_monitor_id);
