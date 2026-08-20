-- 0956_task_repo_bindings.sql
-- Multi-repo spanning: a per-task repo SET.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Until now a run targets exactly ONE repo: `resolveDefaultRepoForTask` picks a
-- single `project_repositories` row (explicit pin → matchHints inference → the
-- project default), every `write_file` commits to that repo's ticket branch, and
-- finalize opens exactly one PR. A task that legitimately crosses repos — "add
-- the endpoint in `api` and call it from `frontend`" — had no way to express
-- that: the agent either committed frontend files into the API repo or gave up.
--
-- This table is the missing edge: (task, repo) with a branch, a write counter and
-- the PR that branch produced. A task with 0 or 1 rows behaves EXACTLY as it does
-- today (one branch, one PR, resolved by the existing single-repo resolver) —
-- multi-repo is an additive capability, not a rewrite of the common case.
--
-- ── ROUTING ─────────────────────────────────────────────────────────────────
-- Which repo receives a given file write is decided by `match_hints` — the same
-- `{labels, keywords, pathGlobs}` JSON shape `project_repositories.match_hints`
-- already carries, and parsed by the same pure `parseMatchHints`. The column here
-- is a per-TASK override: a repo's project-wide hints usually suffice, but one
-- ticket may need "on THIS task, `docs/**` goes to the handbook repo". NULL =
-- inherit the repo's own hints. No match → the task's primary repo, so a write
-- can never be dropped on the floor.
--
-- ── PR PER REPO ─────────────────────────────────────────────────────────────
-- `writes_count` is what makes "skip a repo that got no writes" a fact rather
-- than a guess: finalize opens a PR only for bindings whose counter moved. The
-- primary repo keeps its existing PR path (`tasks.github_pr_url` + the single-PR
-- claim); the extra bindings record their PR here AND as normal `pull_requests`
-- rows, so the PR list/detail surfaces need no special case.
--
-- tenant_id is denormalised (and trigger-derived from the task, mirroring 0944)
-- so every query against this table is checkable by check-tenant-scope.mjs.

CREATE TABLE IF NOT EXISTS task_repo_bindings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    uuid REFERENCES segments(id) ON DELETE CASCADE,
  task_id       integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_id       uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  -- Per-task routing override; NULL = inherit project_repositories.match_hints.
  match_hints   text,
  -- The working branch inside THIS repo. NULL until the first write pins it.
  branch        varchar(255),
  base_branch   varchar(255),
  -- How many files this run set has committed to this repo. 0 => no PR.
  writes_count  integer NOT NULL DEFAULT 0,
  last_write_at timestamp,
  pr_url        varchar(500),
  pr_number     integer,
  pr_status     varchar(16),
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- One binding per (task, repo): re-binding is an upsert, never a duplicate edge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_repo_bindings_task_repo
  ON task_repo_bindings (task_id, repo_id);

-- The read every write and every finalize does: "the repo set for this task".
CREATE INDEX IF NOT EXISTS idx_task_repo_bindings_task
  ON task_repo_bindings (tenant_id, task_id);

-- Derive tenant_id from the owning task, exactly as 0944 derives tasks.tenant_id
-- from the project. The application may omit it; the database keeps it honest,
-- including when a task moves project (the 0944 trigger re-derives the task's
-- tenant, and a task cannot change which task it is, so INSERT-time derivation
-- plus a task-move cascade is sufficient here).
CREATE OR REPLACE FUNCTION set_task_repo_bindings_tenant_id() RETURNS trigger AS $$
DECLARE v_tid integer; v_sid uuid;
BEGIN
  SELECT tenant_id, segment_id INTO v_tid, v_sid FROM tasks WHERE id = NEW.task_id;
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'task_repo_bindings.tenant_id: task % has no tenant', NEW.task_id
      USING ERRCODE = 'not_null_violation';
  END IF;
  NEW.tenant_id := v_tid;
  IF NEW.segment_id IS NULL THEN NEW.segment_id := v_sid; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_repo_bindings_tenant_id ON task_repo_bindings;
CREATE TRIGGER trg_task_repo_bindings_tenant_id
  BEFORE INSERT OR UPDATE OF task_id ON task_repo_bindings
  FOR EACH ROW EXECUTE FUNCTION set_task_repo_bindings_tenant_id();
