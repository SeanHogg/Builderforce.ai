-- Product Management PRD feature.
--
-- (1) Destructive spec_status enum swap:
--       draft|reviewed|approved|in_progress|done  ->  draft|ready|in_progress|complete
--     Remap: reviewed->ready, approved->ready, done->complete (draft/in_progress unchanged).
-- (2) Task<->PRD becomes many-to-many via task_specs (a task may reference 1..N project PRDs,
--     with one optional primary). Backfill from the single tasks.spec_id, then drop that column.
--
-- Idempotent / re-runnable: the enum swap only fires while spec_status still holds the old
-- values (guarded by the absence of spec_status_old); task_specs uses IF NOT EXISTS + ON
-- CONFLICT; the column drop uses IF EXISTS.

-- ---- (1) enum swap (atomic via dollar-quoted DO block) -----------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spec_status')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spec_status_old') THEN

    ALTER TYPE spec_status RENAME TO spec_status_old;
    CREATE TYPE spec_status AS ENUM ('draft', 'ready', 'in_progress', 'complete');

    ALTER TABLE specs ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE specs ALTER COLUMN status TYPE spec_status USING (
      CASE status::text
        WHEN 'reviewed' THEN 'ready'
        WHEN 'approved' THEN 'ready'
        WHEN 'done'     THEN 'complete'
        ELSE status::text            -- draft, in_progress unchanged
      END
    )::spec_status;
    ALTER TABLE specs ALTER COLUMN status SET DEFAULT 'draft';

    DROP TYPE spec_status_old;
  END IF;
END $$;

-- ---- (2) task_specs junction --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_specs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  segment_id  UUID             REFERENCES segments(id) ON DELETE CASCADE,
  task_id     INTEGER NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,
  spec_id     UUID    NOT NULL REFERENCES specs(id)    ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_task_specs UNIQUE (task_id, spec_id)
);
DROP TRIGGER IF EXISTS trg_task_specs_segment ON task_specs;
CREATE TRIGGER trg_task_specs_segment BEFORE INSERT ON task_specs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_task_specs_task ON task_specs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_specs_spec ON task_specs(spec_id);
-- at most one primary PRD per task
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_specs_primary ON task_specs(task_id) WHERE is_primary;

-- ---- (3) backfill from the single tasks.spec_id (tasks derive tenancy via projects) -------
INSERT INTO task_specs (tenant_id, segment_id, task_id, spec_id, is_primary, created_at)
SELECT p.tenant_id, t.segment_id, t.id, t.spec_id, TRUE, NOW()
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE t.spec_id IS NOT NULL
ON CONFLICT (task_id, spec_id) DO NOTHING;

-- ---- (4) drop the now-redundant single-link column ----------------------------------------
ALTER TABLE tasks DROP COLUMN IF EXISTS spec_id;
