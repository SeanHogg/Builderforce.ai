-- 0212_activity_project_attribution.sql
--
-- Per-PROJECT attribution for ingested activity. activity_events was tenant-scoped
-- only (commits/PRs/issues carried repository_full_name but no project link), so the
-- owner rollup could break activity down by repository but not by project, and a
-- connected repo's activity couldn't be drilled into per project.
--
-- This adds activity_events.project_id, resolved at ingest time from the connected
-- repo (project_repositories owner/repo, else projects.source_control_repo_full_name).
-- Nullable + ON DELETE SET NULL: activity from a repo not (yet) linked to a project
-- is still ingested and attributed to a contributor — it just has no project until
-- the repo is linked. Tenant scope is unchanged (a repo belongs to one tenant).
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

-- Rollup read assist: project activity in a time window.
CREATE INDEX IF NOT EXISTS idx_activity_events_project_occurred
  ON activity_events(tenant_id, project_id, occurred_at) WHERE project_id IS NOT NULL;

-- ── activity poller cursor ────────────────────────────────────────────────────
-- The cron poller (runRepoActivitySweep) pulls commits/PRs/reviews from each
-- connected repo via its stored credential — so a repo's activity flows WITHOUT
-- requiring a webhook, and history is backfilled on first sync. This watermark is
-- the last time we polled the repo; NULL = never polled (→ backfill window).
ALTER TABLE project_repositories
  ADD COLUMN IF NOT EXISTS last_activity_synced_at TIMESTAMP;

-- Sweep read assist: due repos (any pollable provider, with a credential) by watermark.
CREATE INDEX IF NOT EXISTS idx_project_repos_activity_sync
  ON project_repositories(provider, last_activity_synced_at) WHERE credential_id IS NOT NULL;
