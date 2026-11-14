-- 0034 · Write-ahead tool intents for PRD 39 §4b fleet failover.
--
-- WHY. A stranded self-hosted run may already have pushed a branch or called a mutating
-- tool, and re-running it could repeat that side effect. "No mutating call in the audit"
-- is NOT a valid safety test: host audit events wait in an in-memory outbox with a 1.5s
-- batch and can lose the last call, and execution_id is optional on that wire. So the
-- rule inverts to write-ahead: BEFORE any tool runs, a write-ahead-capable host appends
-- an intent here with the next per-run seq. Only a NON-allowlisted tool waits for a
-- server ack; on ack the server DELETES the row. A row left behind is a tool that was
-- about to run (or ran) and never got its ack. The stale-execution reaper reads this
-- table (through the OPERATIONAL sibling handle — tool_audit_events lives here) and
-- re-dispatches a stranded run ONLY when its host advertised support AND there is no
-- non-allowlisted intent AND the seq values seen have no gap. Anything else fails closed
-- and asks a human. Old hosts never write here, so their runs fail at the deadline
-- exactly as before.
--
-- References to core entities (executions, agent_hosts, tenants) are plain ids: this
-- endpoint cannot enforce a key across Neon projects, same as tool_audit_events (0013).

CREATE TABLE IF NOT EXISTS tool_intents (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  execution_id integer NOT NULL,
  agent_host_id integer NOT NULL,
  seq integer NOT NULL,
  tool_name varchar(255) NOT NULL,
  requires_ack boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The reaper's read model: all intents for one run, and the held-intent probe.
CREATE INDEX IF NOT EXISTS idx_tool_intents_execution ON tool_intents (execution_id);
CREATE INDEX IF NOT EXISTS idx_tool_intents_created ON tool_intents (created_at);

-- ID FLOOR — same reason as 0013: a push runs this migration and deploys the Worker in
-- one job, so new rows land here before any core copy could collide. 500M leaves int headroom.
SELECT setval(pg_get_serial_sequence('tool_intents', 'id'), GREATEST(500000000, (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'tool_intents_id_seq')), true);
