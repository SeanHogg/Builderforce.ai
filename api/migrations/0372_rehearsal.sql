-- 0372 — Rehearsal: run an agent for real, but let nothing escape.
--
-- WHY THIS EXISTS
--
-- The only measurement of agent autonomy this platform has is production-observed:
-- 0.7% of tickets reach Done autonomously. That number comes from watching live runs
-- fail, because there was no way to run an agent WITHOUT it committing to a branch,
-- opening a PR, writing memory, or asking a human. Every change to a prompt, a policy
-- pack, a persona or a model pin was therefore shipped untested and measured in
-- production, on real tickets, at real cost.
--
-- A rehearsal is the same loop, the same tool registry and the same capability
-- provider as a live run — decorated (application/rehearsal/shadowProvider.ts) so that
-- every EFFECTFUL capability is intercepted and recorded instead of performed, while
-- every READ passes through untouched. Three kinds:
--
--   • dry_run — run a ticket now, suppress the writes, report what WOULD have happened.
--   • replay  — re-run a past execution against the repo ref it originally saw
--               (`frozen_ref`), so the comparison is against the same tree, not
--               against a moved main. This is what makes "did my change make the agent
--               better?" answerable at all.
--   • trial   — one agent over N past tickets, aggregated into a single score.
--
-- WHY REHEARSALS STILL GET AN `executions` ROW: the loop's audit, telemetry, steering
-- and cancellation all key off execution_id, and forking a parallel loop to avoid that
-- would duplicate ~2,700 lines of engine. So a rehearsal reuses the real pipeline and
-- `executions.mode` marks the row. 'live' is the default, so every existing query is
-- byte-identical until it opts in; the aggregate/list reads that must NOT count
-- rehearsals go through the one shared predicate in application/rehearsal/executionMode.ts.

ALTER TABLE executions ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'live';

-- Every autonomy/delivery aggregate filters mode='live'; make that predicate cheap.
CREATE INDEX IF NOT EXISTS executions_mode_tenant_idx
  ON executions (tenant_id, mode);

CREATE TABLE IF NOT EXISTS rehearsals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  -- 'dry_run' | 'replay' | 'trial'
  kind               VARCHAR(16) NOT NULL,
  -- 'queued' | 'running' | 'completed' | 'failed'
  status             VARCHAR(16) NOT NULL DEFAULT 'queued',
  -- Raw ide_agents.id (no FK — same convention as tasks.assigned_agent_ref).
  agent_ref          VARCHAR(64),
  agent_label        VARCHAR(255) NOT NULL DEFAULT 'agent',
  model              VARCHAR(120),
  task_id            INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  -- For kind='replay': the execution being re-run, and the git ref it originally saw.
  source_execution_id INTEGER,
  frozen_ref         VARCHAR(255),
  -- The shadow execution this rehearsal drove (executions.mode = 'rehearsal').
  execution_id       INTEGER,
  -- Rollup so the list view needs no join or per-row aggregate.
  steps              INTEGER NOT NULL DEFAULT 0,
  suppressed_writes  INTEGER NOT NULL DEFAULT 0,
  finished_ok        BOOLEAN,
  summary            TEXT,
  error_message      TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMP,
  completed_at       TIMESTAMP
);

CREATE INDEX IF NOT EXISTS rehearsals_tenant_idx
  ON rehearsals (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rehearsals_task_idx
  ON rehearsals (tenant_id, task_id);
CREATE INDEX IF NOT EXISTS rehearsals_agent_idx
  ON rehearsals (tenant_id, agent_ref, created_at DESC);

-- The suppressed effects, in order. THIS is the deliverable: the diff an agent would
-- have committed, the memory it would have written, the human it would have paged.
CREATE TABLE IF NOT EXISTS rehearsal_steps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rehearsal_id       UUID NOT NULL REFERENCES rehearsals(id) ON DELETE CASCADE,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL,
  -- The capability op, e.g. 'repo.write' / 'repo.edit' / 'memory.remember' / 'human.ask'.
  op                 VARCHAR(64) NOT NULL,
  -- Primary subject: a file path, a memory key, a resource string.
  target             VARCHAR(512),
  -- JSON payload of what would have been written/sent.
  detail             TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS rehearsal_steps_seq_uq
  ON rehearsal_steps (rehearsal_id, seq);
