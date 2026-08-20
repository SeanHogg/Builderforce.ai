-- 1081 — DE-DUPLICATE boards per project, then install the constraint 0111 could not.
--
-- ── WHY 0111 IS STILL A NO-OP ───────────────────────────────────────────────
-- 0111 added `UNIQUE(project_id)` on `boards` and deliberately skipped itself when
-- any project already held duplicates, printing a NOTICE that said "de-dupe those
-- rows by hand first, then re-run". Nobody did. Measured 2026-07-25: project 11
-- holds 7 boards (1 lifecycle_managed, 6 not), project 2 holds 2, project 14 holds
-- 2. The index was therefore never created, so the code-side find-or-create is the
-- ONLY thing preventing new duplicates.
--
-- ── WHY IT MATTERS MORE THAN TIDINESS ───────────────────────────────────────
-- `findCanonicalBoard` picks exactly ONE board per project. Every lane, gate,
-- requirement and agent assignment configured on any of the LOSERS is dead
-- config — present in the UI, described in the board panel, and consulted by
-- nothing. Worse, on project 11 whether the Coordinator state machine or the
-- simple single-hop path runs at all depends on which board wins that selection.
--
-- ── THE MERGE ───────────────────────────────────────────────────────────────
-- The winner is chosen with EXACTLY the ordering `findCanonicalBoard` uses
-- (lifecycle_managed DESC, updated_at DESC, created_at DESC, id DESC), so this
-- migration cannot change which board is authoritative — it only deletes the ones
-- that already had no effect.
--
-- Child rows are handled per table rather than left to ON DELETE CASCADE:
--   • swimlanes    — a loser's lane is re-pointed to the winner ONLY when the
--                    winner has no lane with that key; otherwise it is dropped,
--                    because two lanes with one key on one board violates
--                    UNIQUE(board_id, key) from 0064. A dropped lane's config was
--                    already inert (nothing reads a non-canonical board's lanes).
--   • ticket_runs  — re-pointed when the winner has no run for that task, dropped
--                    otherwise (UNIQUE(board_id, task_id), 0064). A duplicate run
--                    row for the same ticket is by definition the stale one.
--   • ticket_audits — board_id is nullable with ON DELETE SET NULL; re-point so
--                    the audit history keeps its board rather than losing it.
-- `tasks` are NOT touched: they carry no board_id at all (they join through
-- `projects`), which is why the duplicates were invisible in the first place.

DO $$
DECLARE
  merged integer := 0;
BEGIN
  -- The authoritative board per project, by findCanonicalBoard's own ordering.
  CREATE TEMP TABLE _board_winners ON COMMIT DROP AS
  SELECT DISTINCT ON (project_id)
         project_id, id AS winner_id
    FROM boards
   ORDER BY project_id,
            lifecycle_managed DESC,
            updated_at DESC NULLS LAST,
            created_at DESC NULLS LAST,
            id DESC;

  CREATE TEMP TABLE _board_losers ON COMMIT DROP AS
  SELECT b.id AS loser_id, w.winner_id
    FROM boards b
    JOIN _board_winners w ON w.project_id = b.project_id
   WHERE b.id <> w.winner_id;

  SELECT count(*) INTO merged FROM _board_losers;
  IF merged = 0 THEN
    RAISE NOTICE 'boards: no duplicates to merge.';
  ELSE
    RAISE NOTICE 'boards: merging % duplicate board(s) onto their canonical board.', merged;

    -- Audits keep their history on the surviving board.
    UPDATE ticket_audits a
       SET board_id = l.winner_id
      FROM _board_losers l
     WHERE a.board_id = l.loser_id;

    -- Lane rows: re-point when the key is free on the winner, else drop.
    DELETE FROM swimlanes s
     USING _board_losers l
     WHERE s.board_id = l.loser_id
       AND EXISTS (SELECT 1 FROM swimlanes w WHERE w.board_id = l.winner_id AND w.key = s.key);

    UPDATE swimlanes s
       SET board_id = l.winner_id
      FROM _board_losers l
     WHERE s.board_id = l.loser_id;

    -- Ticket runs: re-point when the task is free on the winner, else drop.
    DELETE FROM ticket_runs r
     USING _board_losers l
     WHERE r.board_id = l.loser_id
       AND EXISTS (SELECT 1 FROM ticket_runs w WHERE w.board_id = l.winner_id AND w.task_id = r.task_id);

    UPDATE ticket_runs r
       SET board_id = l.winner_id
      FROM _board_losers l
     WHERE r.board_id = l.loser_id;

    DELETE FROM boards b USING _board_losers l WHERE b.id = l.loser_id;
  END IF;
END $$;

-- The guard 0111 wanted. Now that duplicates are gone it can actually be created;
-- IF NOT EXISTS keeps this idempotent alongside 0111 having created it on any
-- environment that never had duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS boards_project_id_unique ON boards (project_id);

-- An EXPLICIT primary-board pointer, so "which board is this project's board" is a
-- stored fact rather than a four-key sort re-derived on every read.
--
-- Kept alongside the unique index rather than instead of it: the index is what makes
-- a second board impossible, and this column is what makes the answer cheap and
-- inspectable. Deferrable in spirit — nullable, ON DELETE SET NULL — so deleting a
-- board can never block on it.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS primary_board_id UUID REFERENCES boards(id) ON DELETE SET NULL;

UPDATE projects p
   SET primary_board_id = b.id
  FROM boards b
 WHERE b.project_id = p.id
   AND p.primary_board_id IS DISTINCT FROM b.id;
