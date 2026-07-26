-- 0370 — Multi-agent coordination: resource leases + the shared workspace.
--
-- WHY THIS EXISTS
--
-- A swimlane stage is a DAG of `agent_dispatches`. When those dispatches carry no
-- `depends_on`, `computeReadyDispatches` releases ALL of them at once and the stage's
-- success policy ('any' / 'n_of_m') exists precisely so several agents can work the
-- same ticket concurrently. That is a supported, shipped configuration — and until
-- this migration those concurrent agents shared one git branch with no arbiter.
--
-- Two agents in one stage editing the same file is not a race the git API resolves:
-- each reads a blob, string-replaces, and commits to the SAME ticket branch, so the
-- second commit silently reverts the first agent's change to that file. Nothing
-- detected it, because from either agent's point of view its own write succeeded.
--
-- So: mutual exclusion, and a place to talk.
--
--   • `resource_leases` is the lock. The partial unique index is the whole mechanism —
--     at most one LIVE (released_at IS NULL) lease may exist per (tenant, resource),
--     so `INSERT … ON CONFLICT DO NOTHING` is an atomic test-and-set with no advisory
--     lock, no SELECT-then-INSERT race, and no interactive transaction (neon-http has
--     none, per the gap register). A refused insert IS a refused claim.
--
--     `expires_at` makes the lock crash-safe: a run that dies without releasing does
--     not wedge a path forever, because a claim may steal a lease whose expiry has
--     passed. Leases are also released in bulk when a run terminates.
--
--     `resource_key` is the CANONICAL form built by domain/coordination/resourceKey.ts
--     (`repo:<owner>/<name>:path/to/file`), never a raw model string, so a lock on a
--     path is the same lock no matter which agent phrased it.
--
--   • `coordination_notes` is the blackboard: run-scoped WORKING state that concurrent
--     agents publish to each other ("I own the migration"). Deliberately NOT memory —
--     memory is durable cross-ticket knowledge with its own scope/TTL/provenance rules
--     (migration 0371); a blackboard note dies with its ticket.
--
-- Both tables are tenant-scoped and cascade with the tenant, and both index on the
-- coordination scope so the hot read (one ticket's leases + notes) is a single
-- index scan.

CREATE TABLE IF NOT EXISTS resource_leases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Canonical resource identity, e.g. 'repo:acme/web:src/app.ts' or 'repo:acme/web:*'.
  resource_key       VARCHAR(512) NOT NULL,
  -- 'exclusive' (one holder) or 'shared' (many readers; blocks an exclusive claim).
  mode               VARCHAR(16) NOT NULL DEFAULT 'exclusive',
  -- The coordination SCOPE the lease belongs to — the ticket run when a stage is
  -- staffed by several agents, else the ticket. Used for "who else is working here".
  scope_key          VARCHAR(255) NOT NULL,
  -- The holder. execution_id is the run; the label is what a peer agent is shown.
  execution_id       INTEGER,
  holder_label       VARCHAR(255) NOT NULL,
  task_id            INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  reason             TEXT,
  acquired_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMP NOT NULL,
  released_at        TIMESTAMP
);

-- THE mutual-exclusion mechanism: at most one live lease per (tenant, resource).
CREATE UNIQUE INDEX IF NOT EXISTS resource_leases_live_uq
  ON resource_leases (tenant_id, resource_key)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS resource_leases_scope_idx
  ON resource_leases (tenant_id, scope_key)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS resource_leases_execution_idx
  ON resource_leases (execution_id)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS coordination_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_key          VARCHAR(255) NOT NULL,
  task_id            INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  key                VARCHAR(255) NOT NULL,
  content            TEXT NOT NULL,
  author_execution_id INTEGER,
  author_label       VARCHAR(255) NOT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One note per key per scope — posting the same key overwrites (the blackboard holds
-- current intent, not an append log; the tool-audit stream already keeps history).
CREATE UNIQUE INDEX IF NOT EXISTS coordination_notes_scope_key_uq
  ON coordination_notes (tenant_id, scope_key, key);

CREATE INDEX IF NOT EXISTS coordination_notes_scope_idx
  ON coordination_notes (tenant_id, scope_key, updated_at DESC);
