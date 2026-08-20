-- Migration: denormalise tenant_id onto tasks.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `tasks` is the busiest table on the platform and the ONLY way to know which
-- tenant a task belongs to was to join `projects`. That made it invisible to
-- `npm run check:tenant-scope`: the guard reads a statement and asks "does this
-- filter by tenant?", and a query against `tasks` had no tenant column to filter
-- on, so every one of them was structurally unverifiable. `taskProjectIfInTenant`
-- exists precisely because the invariant had to be re-proved by hand at each call
-- site, and a query that joins `tasks` WITHOUT reaching `projects` was simply
-- unchecked.
--
-- Denormalising makes the invariant checkable rather than implicit. It is the
-- same shape `segment_id` already has on this table (migration 0056): a column
-- the application may omit, filled and kept honest by a database trigger.
--
-- ── THE TRIGGER IS NOT OPTIONAL, AND IT IS NOT INSERT-ONLY ──────────────────
-- 0056's `segment_id` trigger fires BEFORE INSERT only, which is correct for a
-- segment (a task does not change segment). A task CAN change project — the
-- board supports moving one — and a moved task whose `tenant_id` still names the
-- OLD tenant is worse than no column at all: it would be a wrong answer that every
-- new tenant-scoped query trusts. So this fires BEFORE INSERT OR UPDATE OF
-- project_id and re-derives from the project every time, which also means the
-- column can never disagree with `projects.tenant_id` no matter who writes it.
--
-- Ordering per 0056: ADD COLUMN -> CREATE TRIGGER -> backfill -> SET NOT NULL, so
-- the column is never NOT NULL without the fill trigger already in place.
-- Guarded by to_regclass() + IF NOT EXISTS so it is idempotent on re-run.

-- Derive tasks.tenant_id from the owning project. Centralises the invariant so no
-- writer has to know it, and so a project move cannot leave a stale tenant behind.
CREATE OR REPLACE FUNCTION set_tasks_tenant_id() RETURNS trigger AS $$
DECLARE v_tid integer;
BEGIN
  SELECT tenant_id INTO v_tid FROM projects WHERE id = NEW.project_id;
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'tasks.tenant_id: project % has no tenant', NEW.project_id
      USING ERRCODE = 'not_null_violation';
  END IF;
  NEW.tenant_id := v_tid;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;

    DROP TRIGGER IF EXISTS trg_tasks_tenant ON tasks;
    CREATE TRIGGER trg_tasks_tenant
      BEFORE INSERT OR UPDATE OF project_id ON tasks
      FOR EACH ROW EXECUTE FUNCTION set_tasks_tenant_id();

    UPDATE tasks x SET tenant_id = p.tenant_id
      FROM projects p
     WHERE x.project_id = p.id AND x.tenant_id IS DISTINCT FROM p.tenant_id;

    ALTER TABLE tasks ALTER COLUMN tenant_id SET NOT NULL;

    -- The guard's predicate leads with tenant_id, so a tenant-scoped board read is
    -- an index scan rather than a filter over every tenant's tasks.
    CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_tenant_project ON tasks(tenant_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks(tenant_id, status);
  END IF;
END $$;
