-- 0235_release_task_link.sql
-- EMP-10: link tasks/epics to a product release so a release is a first-class
-- DELIVERABLE (it was orphaned — product_releases had no edge to the work).
-- With this edge the delivery lens can roll up "all issues/epics in this release",
-- its burnup/forecast, and confirm data accuracy. ON DELETE SET NULL so retiring a
-- release un-links rather than deletes the work. Idempotent / re-runnable.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS release_id uuid REFERENCES product_releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_release ON tasks(release_id) WHERE release_id IS NOT NULL;
