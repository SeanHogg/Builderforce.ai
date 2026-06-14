-- Migration: gate run_workflow lane actions on the spawned workflow's outcome.
--
-- Before this, a lane whose action is `run_workflow` fired the workflow
-- fire-and-forget and advanced the ticket immediately — it never waited for the
-- spawned workflow to reach completed/failed, nor mapped that outcome back onto
-- the ticket. This adds the link column the SwimlaneCoordinator parks on: a
-- ticket in lifecycle 'awaiting_workflow' records the workflow id it is blocked
-- on here; a cron sweep resumes it (advance on success / needs_attention on
-- failure) once that workflow settles. Nullable + ON DELETE SET NULL so deleting
-- the workflow simply unparks the link. Idempotent.
ALTER TABLE ticket_runs
  ADD COLUMN IF NOT EXISTS awaiting_workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL;
