-- Reversible external-system imports. Every canonical artifact created by a
-- migration commit carries its run id, so rollback never guesses from names or
-- deletes pre-existing mapped projects.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS import_run_id uuid REFERENCES import_runs(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS import_run_id uuid REFERENCES import_runs(id) ON DELETE SET NULL;
ALTER TABLE board_connections ADD COLUMN IF NOT EXISTS import_run_id uuid REFERENCES import_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_import_run ON projects(import_run_id) WHERE import_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_import_run ON tasks(import_run_id) WHERE import_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_board_connections_import_run ON board_connections(import_run_id) WHERE import_run_id IS NOT NULL;

ALTER TABLE import_runs DROP CONSTRAINT IF EXISTS import_runs_status_check;
ALTER TABLE import_runs ADD CONSTRAINT import_runs_status_check CHECK (status IN ('discovering','staged','mapped','importing','completed','failed','cancelled','rolled_back'));
