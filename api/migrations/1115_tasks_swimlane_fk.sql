-- 1115 · `tasks.swimlane_id` — the board column a ticket sits in, as a REFERENCE
--        rather than a string convention.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- The board's columns ARE its swimlanes (fully configurable, any key), but a
-- ticket was tied to its lane by `tasks.status = swimlanes.key` and NOTHING
-- else. A string convention across two tables is not a relationship:
--
--   • Deleting a lane left every resident ticket holding a status no lane
--     defined. `reassignOrphanedTasksOnLaneDelete` closes that on the delete
--     PATH, but nothing closed it in the DATA — a board wiped by any other route
--     (a template import, a direct DELETE, a restored backup) still produced
--     tickets in no column, and there was no query that could even FIND them.
--   • RENAMING a lane key was simply not offered, because it could not be done
--     safely: the tickets would have been orphaned the instant the key changed,
--     and there was no way to enumerate "the tickets in THIS lane" except by the
--     very string being changed. Custom-lane kanbans could be created but never
--     corrected.
--   • Nothing could JOIN a ticket to its lane's configuration (gate, parking,
--     terminal, requirement gate) without re-deriving the board first.
--
-- This is the same shape `tenant_id` (0944) and `segment_id` (0056) already have
-- on this table: a column the application may omit, filled and kept honest by a
-- database trigger, so no writer has to know the invariant. `status` remains the
-- ticket's own fact and the single source of truth; `swimlane_id` is DERIVED from
-- it, with the database as the only writer.
--
-- ── ON DELETE SET NULL IS THE POINT ─────────────────────────────────────────
-- A NULL `swimlane_id` on a ticket whose project HAS a board is exactly the
-- orphan state, and now it is a value a query can select. It is not an error to
-- repair blindly — a ticket can legitimately hold a status no lane defines while
-- an operator is mid-reconfiguration — it is a condition the board surfaces (the
-- appended orphan column) and the lane editor can act on.

-- ── 1 · Derive tasks.swimlane_id from (the project's board, the ticket's status)
--
-- Fires on the two writes that can change the answer: the status moving, and the
-- ticket moving PROJECT (the board changes underneath it, exactly the case 0944's
-- tenant trigger had to cover). NULL when no lane matches — that IS the orphan
-- signal, so this never invents a lane.
--
-- The board is resolved the same way `findCanonicalBoard` resolves it: the stored
-- `projects.primary_board_id` pointer (1081) wins, falling back to the board that
-- owns the project (`boards.project_id` is UNIQUE since 1081) for a project whose
-- pointer was never stamped.
CREATE OR REPLACE FUNCTION set_tasks_swimlane_id() RETURNS trigger AS $$
DECLARE v_board uuid;
BEGIN
  SELECT COALESCE(p.primary_board_id, (SELECT b.id FROM boards b WHERE b.project_id = p.id LIMIT 1))
    INTO v_board
    FROM projects p
   WHERE p.id = NEW.project_id;

  IF v_board IS NULL THEN
    NEW.swimlane_id := NULL;
    RETURN NEW;
  END IF;

  SELECT s.id INTO NEW.swimlane_id
    FROM swimlanes s
   WHERE s.board_id = v_board AND s.key = NEW.status
   LIMIT 1;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ── 2 · Re-link residents when a lane APPEARS or is RENAMED
--
-- The task-side trigger only fires when the TICKET is written. The other half of
-- the relationship moves too: create a custom lane whose key forty tickets
-- already hold (the normal shape of "we've been using this status informally"),
-- or rename a lane's key, and those tickets must follow. Doing it here rather
-- than in the rename use case means no write path can forget it — a template
-- apply, a raw SQL fix and the board API all land in the same place.
--
-- No recursion: this UPDATE touches `swimlane_id` only, and the task trigger
-- above fires on UPDATE OF status, project_id.
CREATE OR REPLACE FUNCTION relink_tasks_to_swimlane() RETURNS trigger AS $$
DECLARE v_project integer;
BEGIN
  SELECT project_id INTO v_project FROM boards WHERE id = NEW.board_id;
  IF v_project IS NULL THEN RETURN NEW; END IF;

  -- Tickets that now belong to this lane.
  UPDATE tasks SET swimlane_id = NEW.id
   WHERE project_id = v_project AND status = NEW.key AND swimlane_id IS DISTINCT FROM NEW.id;

  -- Tickets that pointed AT this lane but no longer carry its key (a rename whose
  -- cascade did not reach them). They are orphans until something re-homes them,
  -- and saying so is the whole point of the column.
  UPDATE tasks SET swimlane_id = NULL
   WHERE project_id = v_project AND swimlane_id = NEW.id AND status IS DISTINCT FROM NEW.key;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.swimlanes') IS NOT NULL THEN
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS swimlane_id UUID REFERENCES swimlanes(id) ON DELETE SET NULL;

    DROP TRIGGER IF EXISTS trg_tasks_swimlane ON tasks;
    CREATE TRIGGER trg_tasks_swimlane
      BEFORE INSERT OR UPDATE OF status, project_id ON tasks
      FOR EACH ROW EXECUTE FUNCTION set_tasks_swimlane_id();

    DROP TRIGGER IF EXISTS trg_swimlanes_relink_tasks ON swimlanes;
    CREATE TRIGGER trg_swimlanes_relink_tasks
      AFTER INSERT OR UPDATE OF key ON swimlanes
      FOR EACH ROW EXECUTE FUNCTION relink_tasks_to_swimlane();

    -- Backfill every existing ticket from its project's board.
    --
    -- The joins to `b` and `s` cannot live in ON clauses here: FROM-list JOINs are
    -- resolved before the target table `x` is in scope, so `s.key = x.status` inside
    -- an ON clause fails with "invalid reference to FROM-clause entry for table x".
    -- Postgres only lets UPDATE...FROM correlate with the target table in WHERE, so
    -- the FROM list is a plain cross join and every join predicate — including the
    -- ones that don't mention `x` — moves to WHERE instead.
    UPDATE tasks x
       SET swimlane_id = s.id
      FROM projects p, boards b, swimlanes s
     WHERE x.project_id = p.id
       AND b.id = COALESCE(p.primary_board_id, (SELECT b2.id FROM boards b2 WHERE b2.project_id = p.id LIMIT 1))
       AND s.board_id = b.id
       AND s.key = x.status
       AND x.swimlane_id IS DISTINCT FROM s.id;

    -- Lane-scoped reads (the rename cascade, "tickets in this lane", the orphan
    -- census) lead with the lane, so they are an index scan rather than a filter
    -- over every ticket on the platform.
    CREATE INDEX IF NOT EXISTS idx_tasks_swimlane ON tasks(swimlane_id);
    -- The orphan census: tenant-scoped, and only ever asks for the NULL side.
    CREATE INDEX IF NOT EXISTS idx_tasks_orphan_lane ON tasks(tenant_id) WHERE swimlane_id IS NULL;
  END IF;
END $$;
