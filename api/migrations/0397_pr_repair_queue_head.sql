-- The autonomous executor probes this partial order for every candidate ticket:
-- failed open PRs are a serial integration queue, and only its oldest head may
-- start another agent run. Keep that correlated head lookup index-backed as the
-- reconciliation ledger grows.
CREATE INDEX IF NOT EXISTS idx_pull_requests_failed_repair_queue
  ON pull_requests(tenant_id, project_id, created_at, id)
  WHERE status = 'open' AND build_status = 'failure' AND task_id IS NOT NULL;
