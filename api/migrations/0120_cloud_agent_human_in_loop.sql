-- Cloud-agent human-in-the-loop.
--
-- A blocked/uncertain cloud agent (V2 durable/worker) can now bubble a question
-- up to a human via the SAME `approvals` table that self-hosted agents use, then
-- pause until it is answered. Two enablers:
--
--   1. Scope an approval to a cloud run. Cloud runs have no agent_host_id; like
--      the telemetry tables (migration 0092) they identify by cloud_agent_ref +
--      execution_id, so the answer can be routed back to the exact paused run.
--   2. A `paused` execution state — distinct from `running` (it is NOT spending)
--      and from terminal (it WILL resume once answered). The frontend already
--      anticipated this value (AgentChip `resume` affordance); this lands it.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS execution_id integer;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS cloud_agent_ref varchar(64);

-- Index the resume lookup (answer a question → find its paused run).
CREATE INDEX IF NOT EXISTS approvals_execution_id_idx ON approvals (execution_id);

-- New non-terminal execution state for a run waiting on a human answer.
-- ADD VALUE runs as its own statement (the migration runner does not wrap the
-- file in one transaction) and the value is not used elsewhere in this file, so
-- the Postgres "can't use a new enum value in the same transaction" rule is moot.
ALTER TYPE execution_status ADD VALUE IF NOT EXISTS 'paused';
