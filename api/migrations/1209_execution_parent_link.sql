-- 1209 · A cloud sub-agent is its OWN execution, linked to the run that spawned it.
--
-- Until now a cloud child ran INSIDE one of its parent's tool calls (`runSubagent`),
-- bounded at 8 steps so it fit one durable alarm tick, and the parent was blocked for
-- the whole of it. A child is now an ordinary durable execution on the parent's ticket:
-- it runs beside its parent with no step cap, the parent keeps working, redirects it
-- (a steer on the child) or stops it (a cancel), and the child's report reaches the
-- parent as a steer on the PARENT. This column is the owner pointer that makes that
-- possible — the cloud form of the editor's run lineage.
--
--   parent_execution_id  The run that spawned this one; NULL for every other run.
--                        A child is part of its parent's run, not a run of its own:
--                        `liveExecution()` excludes it from delivery aggregates, its
--                        tokens meter under the parent, and it never moves the ticket.
--                        ON DELETE CASCADE — a child has no meaning without its parent.
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS parent_execution_id integer REFERENCES executions(id) ON DELETE CASCADE;

-- "Which of my children are still running?" is asked on every finish attempt and every
-- wait poll; partial so the index holds only the rare child rows.
CREATE INDEX IF NOT EXISTS executions_parent_execution_id_idx
  ON executions (parent_execution_id)
  WHERE parent_execution_id IS NOT NULL;
