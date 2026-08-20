-- Pause/resume state for a cloud run parked on `ask_human`.
--
-- ── WHY A TABLE AND NOT THE DO CURSOR ───────────────────────────────────────
-- The durable surface (CloudRunnerDO) can park a run in its own storage: the
-- cursor already holds the loop state and `/resume` re-arms the alarm. Neither of
-- the other two cloud surfaces can. The container and the GitHub Actions runner
-- each drive the WHOLE loop inside one process whose conversation lives only in
-- that process's memory; when it exits (image torn down, job finished) the
-- messages are gone. So a pause on those surfaces is exit-and-redispatch, and the
-- thing that must outlive the process is exactly this row.
--
-- It also answers a question no surface could answer before: WHERE was the ticket
-- before we moved it. Routing a paused ticket into the board's needs-attention
-- lane is only safe if resume can put it back, and "put it back" needs the origin
-- recorded at the moment of the move — not re-derived later from history.
--
-- ONE ROW PER EXECUTION. A run has at most one outstanding question; answering it
-- clears the row (the resume path deletes it), and a second pause writes a fresh
-- one. The UNIQUE constraint is what makes the resume read a point lookup and
-- makes a double-pause impossible rather than merely unlikely.
CREATE TABLE IF NOT EXISTS execution_pause_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  execution_id   INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- WHICH surface parked the run: 'durable' | 'container' | 'github_actions'.
  -- Resume dispatches off THIS, never off a guess — waking every surface would
  -- start a second, concurrent run of the same execution on the surfaces that
  -- redispatch.
  surface        VARCHAR(16) NOT NULL,
  -- The `approvals` row (kind='question') a human answers to resume. Also the
  -- idempotency nonce for the paused/resumed chat milestones.
  approval_id    UUID,
  -- The ticket's lane the moment before we routed it to needs-attention, and the
  -- lane we actually routed it to. `routed_lane` NULL = the ticket was not moved
  -- (no board, or it was already sitting in the target lane), so resume leaves it
  -- alone instead of "restoring" a move that never happened.
  origin_lane    VARCHAR(120),
  routed_lane    VARCHAR(120),
  -- The exit-and-redispatch payload: JSON { messages, writtenPaths, step }. NULL
  -- for the durable surface, which resumes from its own DO cursor.
  loop_state     TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One outstanding pause per run (see above).
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_pause_state_execution
  ON execution_pause_state (execution_id);

-- The resume read: tenant-scoped point lookup by execution.
CREATE INDEX IF NOT EXISTS idx_execution_pause_state_tenant
  ON execution_pause_state (tenant_id, execution_id);
