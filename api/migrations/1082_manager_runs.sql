-- 1082 — Persist a manager pass's outcome STRUCTURALLY, not as an English sentence.
--
-- ── WHAT IT REPLACES ────────────────────────────────────────────────────────
-- `finalizeManagerRunTask` rendered the whole `ManagerRunSummary` into
-- `tasks.description` — "Scored 0 · ranked 300 · assigned 0 · PRs 4 · dispatched 0
-- · audited 40 (12 flagged)" — and stored nothing else. The frontend then had to
-- regex that sentence back apart (`managerDiagnostics.parsePassCounters`) to detect
-- the single most load-bearing failure the manager has: a pass that COMPLETES and
-- changes nothing.
--
-- Two consequences, both real:
--   1. The detection silently degrades the moment anyone rewords the sentence. It
--      is a UI string being used as a wire format.
--   2. No query can answer "how many passes actually scored anything this month?",
--      because the numbers are not columns — they are prose. Pass effectiveness
--      over time is unanswerable, and so is a pass-history chart.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- One row per pass, keyed by the run task it closed (`run_task_id` UNIQUE), which
-- is the identity `finalizeManagerRunTask` already has in hand and the id every
-- `manager_actions` row from that pass already carries. The counters live in a
-- single `summary` jsonb rather than twenty columns: the set grows with each new
-- stage (six were added in the last four passes), and a migration per counter is
-- exactly the friction that would push the next one back into the prose.
--
-- The counters that are QUERIED are also promoted to real columns, because "did
-- this pass change anything?" must be an index scan and not a jsonb walk on every
-- row: `changed` is the derived answer, and `ok` / `shed_stages` say whether the
-- pass finished and what it dropped.
--
-- The prose stays on the task description. It is a good sentence for a human
-- reading the run card; it simply stops being the only copy of the data.

CREATE TABLE IF NOT EXISTS manager_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The "Backlog management pass" card this row closes. ON DELETE CASCADE: the pass
  -- history is about that card, so reaping the card reaps its row.
  run_task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- Did the pass finish, or end early?
  ok             BOOLEAN NOT NULL DEFAULT TRUE,
  -- Did it CHANGE anything? The one question the regex existed to answer.
  changed        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Stages shed for wall-clock budget; empty on a complete pass.
  shed_stages    TEXT,
  -- The full ManagerRunSummary, verbatim.
  summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per pass. The finalize path upserts on it, so a retried finalize cannot
-- write a second row for the same pass.
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_runs_run_task ON manager_runs (run_task_id);

-- "This project's recent passes, newest first" — the overview read and the
-- pass-history chart.
CREATE INDEX IF NOT EXISTS idx_manager_runs_project_created
  ON manager_runs (tenant_id, project_id, created_at DESC);

-- "How many passes did nothing this month?" — the effectiveness query, which is the
-- whole reason the counters stopped being prose.
CREATE INDEX IF NOT EXISTS idx_manager_runs_ineffective
  ON manager_runs (tenant_id, project_id, created_at DESC)
  WHERE changed = FALSE;
