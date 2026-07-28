-- 0381 — Index the manager's PR action log, so the PR loop can be fair AND bounded.
--
-- WHY: `coordinatePullRequests` reads `manager_actions` to answer three questions every
-- pass, for every project, every five minutes:
--
--   1. how many times has this PR been synced with its base without merging?  (the
--      sync ceiling — 40,580 syncs against 10 merges all-time when it was added)
--   2. how many times has the PROVIDER refused to merge it?                   (new: the
--      merge ceiling — "Could not merge PR #29 … not mergeable" fired once per pass
--      indefinitely, because the refusal was journalled as a generic 'flag' and nothing
--      could count it)
--   3. when did the loop last do ANY of that to this PR?                      (new: the
--      rotation — the query was an unordered LIMIT 20 over 386 open PRs, so the same
--      twenty rows came back every pass and 366 were never examined once)
--
-- All three now come from ONE grouped scan, replacing three. But `manager_actions` is
-- append-only and grows by ~3,500 rows a day on a single active project (measured on
-- project 11, 2026-07-28), and the only indexes it has are (tenant_id, project_id,
-- created_at DESC) for the feed and (run_task_id). A group-by over action_type/task_id
-- was therefore a sequential scan on a five-minute path, and got worse every day.
--
-- This index covers the filter (tenant, project, action_type) and the grouping key
-- (task_id) in that order, so the scan becomes an index-only range read over the handful
-- of PR action types rather than the whole project's decision history.
--
-- No data change and no new table: the ceilings are read from the log the loop already
-- writes. See ManagerService `PR_ACTION_TYPES`.

CREATE INDEX IF NOT EXISTS idx_manager_actions_pr_ceiling
  ON manager_actions(tenant_id, project_id, action_type, task_id);

COMMENT ON INDEX idx_manager_actions_pr_ceiling IS
  'Serves the AI Manager PR loop: per-ticket counts of sync_pr / merge_failed / merge_blocked and the newest PR action per ticket (least-recently-worked rotation). Added 0381 — the prior grouped reads were sequential scans over an append-only table growing ~3.5k rows/day per active project.';
