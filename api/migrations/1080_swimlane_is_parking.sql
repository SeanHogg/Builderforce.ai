-- 1080 — Mark a swimlane as PARKED: off the delivery path, not a stage work flows through.
--
-- ── THE MISREPORT ───────────────────────────────────────────────────────────
-- `computeCompletion` (api/src/application/task/ticketContext.ts) ranks a ticket
-- by its lane's `position` within the board's ordered lanes. The default board —
-- and the SDLC template — place `Blocked` at position 7 of 9, i.e. between review
-- and Done. So a BLOCKED ticket, which by definition is not progressing at all,
-- reported as roughly 87% complete. The most stuck ticket on the board read as
-- the most finished one.
--
-- ── WHY A COLUMN AND NOT A KEY LIST ─────────────────────────────────────────
-- `nextLane.ts` already carries a hardcoded `PARKED_LANE_KEYS` set
-- (blocked / on_hold / cancelled) because it hit the same omission from the other
-- side: completion was ADVANCING tickets into `blocked` simply because it sat next
-- in position order. That key set is the right rule and the wrong mechanism — it
-- cannot see a tenant's own parking lane ("On Hold — Q3", "Waiting on Legal"), so
-- every custom board keeps both bugs.
--
-- `is_terminal` exists and does not answer this: a parked lane is not an ENDING,
-- it is a detour. A ticket in `blocked` has not finished; it is waiting on a
-- dependency, which is why `autonomousExecutionSweep.RUNNABLE_STATUSES`
-- deliberately refuses to scan it.
--
-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- Seeded from exactly the key set the code already treats as parked, so this
-- migration changes NO behaviour on an existing board — it only makes the
-- existing rule editable, and extends it to lanes the key set could never match.
-- New lanes default to false: an ordinary stage is the common case, and a lane
-- wrongly marked parked would silently drop out of every completion denominator.

ALTER TABLE swimlanes
  ADD COLUMN IF NOT EXISTS is_parking BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE swimlanes
   SET is_parking = TRUE
 WHERE is_parking = FALSE
   AND key IN ('blocked', 'on_hold', 'cancelled');

-- The completion rank and the next-lane walk both filter on it, always alongside
-- the board, so it rides the existing (board_id) access path.
CREATE INDEX IF NOT EXISTS idx_swimlanes_board_parking
  ON swimlanes (board_id)
  WHERE is_parking = TRUE;
