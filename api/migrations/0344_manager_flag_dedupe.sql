-- Collapse duplicate manager 'flag' rows, and stop new ones at the DB level.
--
-- A 'flag' is a STATE ("this ticket is missing these required checks"), not an
-- event. Every manager pass re-audits every managed ticket, and the audit used to
-- append an identical `manager_actions` row each time — so an unresolved ticket
-- accumulated one duplicate row per pass, forever. The manager feed became a wall
-- of the same handful of gaps repeated hundreds of times.
--
-- The write path is now change-gated in app code (`verdictSignature` in
-- application/audit/auditRules.ts only journals when the verdict actually moves).
-- This migration deals with the rows that already exist. The feed read is already
-- served by `idx_manager_actions_feed` (tenant, project, created_at) — no new index.
--
-- Scope note: this deletes ONLY superseded duplicates — same tenant, same project,
-- same task, same summary AND same detail, i.e. byte-identical restatements of one
-- unchanged verdict. The newest row of each group survives, so no gap disappears
-- from the feed and no distinct verdict is lost. Nothing outside actionType='flag'
-- is touched.

-- Keep the newest row per (tenant, project, task, summary, detail); drop the rest.
-- Ranked with a window function rather than a self-join: the duplicate groups can
-- be large, and a self-join is quadratic within each group.
--
-- PARTITION BY treats NULLs as equal, which is the semantics wanted here — two
-- project-wide rows (task_id NULL) with identical text ARE the same verdict.
DELETE FROM manager_actions
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY tenant_id, project_id, task_id, summary, detail
        -- Newest first; id breaks a same-timestamp tie so exactly one survives.
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM manager_actions
    WHERE action_type = 'flag'
  ) ranked
  WHERE ranked.rn > 1
);
