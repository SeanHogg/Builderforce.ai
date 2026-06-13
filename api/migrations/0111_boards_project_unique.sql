-- 0111_boards_project_unique.sql
-- Enforce the one-board-per-project invariant GOING FORWARD.
--
-- Find-or-create (boardRoutes POST / + Brain boards.create, both via the shared
-- findOrCreateBoard service) now converges every create path on the project's
-- existing board, so no NEW duplicates can be inserted. This adds the matching
-- DB guard: a UNIQUE index on boards(project_id).
--
-- IMPORTANT — pre-existing duplicates are NOT auto-merged here (deliberate: a
-- destructive merge of split swimlanes/tickets onto one board is out of scope).
-- If a project already holds >1 board, this migration is a SAFE NO-OP that
-- RAISES A NOTICE instead of failing — de-dupe those rows by hand first (merge
-- the lanes+tickets onto the earliest board per project, drop the rest), then
-- re-run this migration to install the constraint.
--
-- The index is keyed on project_id alone (not tenant+project): a project already
-- belongs to exactly one tenant, so project_id is sufficient — and it matches the
-- existing-board lookup the service performs.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT project_id
    FROM boards
    GROUP BY project_id
    HAVING count(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Skipping UNIQUE(project_id) on boards: % project(s) still hold duplicate boards. De-dupe manually (merge lanes+tickets onto the earliest board per project), then re-run this migration.', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS boards_project_id_unique ON boards (project_id);
  END IF;
END $$;
