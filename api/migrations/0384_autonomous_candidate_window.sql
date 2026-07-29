-- 0384 — Index the "does this ticket have a live run?" probe the executor's candidate
-- window now runs, and which `listActiveByTasks` has always run unindexed.
--
-- WHY: `loadAutonomousCandidates` bounds one tick to 400 rows under a total, stable order
-- (manager rank → priority tier → updated_at). A fixed cap over a fixed order is a set,
-- not a window: with more qualifying tickets than the limit, the SAME rows are examined on
-- every tick and everything below is structurally unreachable. The bound was justified by
-- "each dispatched ticket becomes a live run and is skipped next tick" — but that skip
-- happened in the lane EVALUATOR, one layer down, while the ticket kept its slot in the
-- window.
--
-- Measured on project 11, 2026-07-29: 372 of 670 stalled tickets `never_started`, oldest
-- idle 49 days, on a board that completed 2,151 agent runs that same day and holds 708
-- managed tickets against the 400-row window. Not delayed — never looked at.
--
-- The candidate scan now excludes tickets with a live run, so a dispatched ticket vacates
-- its slot and the next-priority ticket takes it. That makes the probe a CORRELATED NOT
-- EXISTS over `executions`, evaluated per candidate row on a five-minute cron path, on a
-- table growing by thousands of rows a day. `executions` carries indexes on claw_id,
-- session_id, (tenant_id, session_id), segment_id and (tenant_id, mode) — none of which
-- serves it. Unindexed, the fix for one starvation would have introduced a sequential scan
-- in its place.
--
-- (task_id, status) in that order: task_id is the correlation key and the most selective,
-- status filters to the four non-terminal values. `mode` is deliberately NOT in the index
-- — it is low-cardinality and nearly always 'live', so it is cheaper as a heap recheck
-- than as a third key column. The same index also serves `RuntimeService.listActiveByTasks`
-- ("does this ticket still have a live run?"), which every manager pass, the PR loop and
-- the census all call and which has been running unindexed on the same path.

CREATE INDEX IF NOT EXISTS idx_executions_task_status
  ON executions(task_id, status);

COMMENT ON INDEX idx_executions_task_status IS
  'Serves "does this ticket have a live run?" — the autonomous executor''s candidate-window exclusion (0384) and RuntimeService.listActiveByTasks. Both are per-tick, correlated on task_id and filtered to the non-terminal statuses.';
