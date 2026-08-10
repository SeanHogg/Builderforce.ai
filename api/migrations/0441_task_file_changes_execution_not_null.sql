-- Every file-change event belongs to the execution that produced it. Backfill the
-- historical nullable rows with the closest preceding execution for the same task and
-- tenant, then make that provenance mandatory for every future writer.

UPDATE task_file_changes AS change
SET execution_id = (
  SELECT execution.id
  FROM executions AS execution
  WHERE execution.task_id = change.task_id
    AND execution.tenant_id = change.tenant_id
    AND execution.created_at <= change.created_at
  ORDER BY execution.created_at DESC, execution.id DESC
  LIMIT 1
)
WHERE change.execution_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM task_file_changes AS change
    LEFT JOIN executions AS execution ON execution.id = change.execution_id
    WHERE change.execution_id IS NULL
       OR execution.id IS NULL
       OR execution.task_id <> change.task_id
       OR execution.tenant_id <> change.tenant_id
  ) THEN
    RAISE EXCEPTION 'task_file_changes contains rows that cannot be attributed to a live execution; repair them before applying 0441';
  END IF;
END $$;

ALTER TABLE task_file_changes
  ALTER COLUMN execution_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_task_file_changes_execution'
      AND conrelid = 'task_file_changes'::regclass
  ) THEN
    ALTER TABLE task_file_changes
      ADD CONSTRAINT fk_task_file_changes_execution
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_file_changes_execution
  ON task_file_changes (execution_id, created_at DESC);
