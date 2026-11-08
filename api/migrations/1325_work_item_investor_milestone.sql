-- 1325 · A work item can be flagged as an investor milestone (expand-only).
--
-- A milestone is a fact about a work item, so it is one column on `tasks`, not a
-- second table or a copy of the item. The investor update and the board pack read
-- the items flagged here that were completed in their window.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS investor_milestone boolean NOT NULL DEFAULT false;

-- The window read is "flagged AND completed between two instants, per tenant".
CREATE INDEX IF NOT EXISTS idx_tasks_investor_milestone_completed
  ON tasks (tenant_id, completed_at)
  WHERE investor_milestone = true;

-- "When did the last investor update go out" scans sent rows of one template per tenant.
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_template_status_created
  ON deliveries (tenant_id, template, status, created_at);
