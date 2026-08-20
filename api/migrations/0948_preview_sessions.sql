-- 0948_preview_sessions.sql
-- Live container preview — the LEASE that makes a preview budgetable.
--
-- ── WHY A TABLE ─────────────────────────────────────────────────────────────
-- Phase 2 shipped the transport (signed token → `preview.builderforce.ai/<tok>/*`
-- → AgentContainerDO → the run's dev server). What it had no representation of is
-- the thing that COSTS money: a container instance held open for an editor tab.
-- `AgentContainerDO` is capped at a fixed `max_instances`, so without a ledger the
-- first tenant to open a handful of previews starves every cloud run on the
-- deployment, and nothing can answer "is this preview still being watched?".
--
-- One row per execution's preview:
--   • `status`        — starting → live → (idle_evicted | stopped | failed)
--   • `last_seen_at`  — bumped by the ingress on real preview traffic (throttled),
--                       so idleness is a MEASURED fact, not a guess
--   • `port`          — the PREVIEW_PORT the dev server was told to bind
--
-- ── WHAT IT BUYS ────────────────────────────────────────────────────────────
--   1. Per-tenant concurrency cap  — count this tenant's live rows before minting.
--   2. Global instance budget      — count all live rows; refuse past the budget.
--   3. Idle eviction tighter than the DO's `sleepAfter` — a sweep stops containers
--      whose preview has not been fetched for PREVIEW_IDLE_EVICTION_MS. A preview
--      idles the moment the editor tab closes; a long agent run does not, which is
--      exactly why this cannot be expressed as one global `sleepAfter`.
--
-- tenant_id is denormalised (trigger-derived from the execution, mirroring 0944/0947)
-- so every read is checkable by check-tenant-scope.mjs, and so the ingress — which
-- authenticates with a preview TOKEN and therefore knows only the execution id — can
-- resolve the owning tenant without a join.

CREATE TABLE IF NOT EXISTS preview_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     uuid REFERENCES segments(id) ON DELETE CASCADE,
  execution_id   integer NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  -- Denormalised so "the live preview for THIS project" is one indexed read (the
  -- Mobile panel mints by project; it has no execution id to offer).
  project_id     integer REFERENCES projects(id) ON DELETE CASCADE,
  -- The port the dev server was told to bind inside the container.
  port           integer NOT NULL,
  -- starting | live | failed | idle_evicted | stopped
  status         varchar(16) NOT NULL DEFAULT 'starting',
  -- Health-check / failure detail, surfaced to the panel so "no preview" says why.
  detail         text,
  started_at     timestamp NOT NULL DEFAULT now(),
  -- Last REAL preview request served through the ingress. Idle eviction reads this.
  last_seen_at   timestamp NOT NULL DEFAULT now(),
  stopped_at     timestamp,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

-- One preview per execution: re-arming is an upsert, never a second lease (and a
-- second lease would be a second instance charged against the budget).
CREATE UNIQUE INDEX IF NOT EXISTS uq_preview_sessions_execution
  ON preview_sessions (execution_id);

-- The two counting reads: "this tenant's live previews" and "the deployment's".
CREATE INDEX IF NOT EXISTS idx_preview_sessions_tenant_status
  ON preview_sessions (tenant_id, status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_preview_sessions_status_seen
  ON preview_sessions (status, last_seen_at);

-- "The live preview for this project" — the Mobile panel's mint path.
CREATE INDEX IF NOT EXISTS idx_preview_sessions_project
  ON preview_sessions (tenant_id, project_id, status);

-- Derive tenant_id (and segment_id) from the owning execution, exactly as 0947
-- derives them from the owning task. The application supplies it too; the database
-- keeps it honest so a mis-scoped insert cannot create a cross-tenant lease.
CREATE OR REPLACE FUNCTION set_preview_sessions_tenant_id() RETURNS trigger AS $$
DECLARE v_tid integer; v_sid uuid;
BEGIN
  SELECT tenant_id, segment_id INTO v_tid, v_sid FROM executions WHERE id = NEW.execution_id;
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'preview_sessions.tenant_id: execution % has no tenant', NEW.execution_id
      USING ERRCODE = 'not_null_violation';
  END IF;
  NEW.tenant_id := v_tid;
  IF NEW.segment_id IS NULL THEN NEW.segment_id := v_sid; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_preview_sessions_tenant_id ON preview_sessions;
CREATE TRIGGER trg_preview_sessions_tenant_id
  BEFORE INSERT OR UPDATE OF execution_id ON preview_sessions
  FOR EACH ROW EXECUTE FUNCTION set_preview_sessions_tenant_id();
