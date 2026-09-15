-- 1171: the task swimlane trigger does nothing when neither input changed.
--
-- 1115's trg_tasks_swimlane fires BEFORE UPDATE OF status, project_id, i.e. whenever an
-- UPDATE names either column in its SET list — including the many writers that set
-- `status` to the value it already has. Each firing resolved the project's board and
-- lane (reads of `projects`, `boards`, `swimlanes`). Measured 2026-09-14 on the primary:
-- `boards`, `swimlanes` and `projects` read ~5M times each on 14 / 111 / 41 rows, part of
-- the load that exhausted the Neon compute quota.
--
-- An UPDATE that leaves both status and project_id as they were keeps the swimlane it
-- already has, which is exactly what the lookup would have produced. Inserts and real
-- changes behave as before.
CREATE OR REPLACE FUNCTION set_tasks_swimlane_id() RETURNS trigger AS $$
DECLARE v_board uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;

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
