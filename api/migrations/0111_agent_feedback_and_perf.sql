-- 0111_agent_feedback_and_perf.sql
-- Owner-only agent performance + buyer feedback surface (gap [1247]).
--
-- Until now an agent owner could see only the cumulative "Hired N×" count and the
-- owner-only "in use" (active-hires) number. There was no way for a buyer to leave
-- a rating/comment, and no per-agent performance rollup (success rate / runs /
-- latency). This table is the missing feedback record; the perf rollup is computed
-- live from the `executions` telemetry joined to active `agent_purchases`
-- (read-through cached, keyed on agent_id, invalidated on a new feedback row).
--
-- One feedback row per submission, keyed to the (tenant, agent) hire so feedback
-- has provenance: it references the agent_purchases row the buyer holds. The agent
-- id is denormalized for the owner-side rollup join (which scopes by agent, not by
-- a single purchase). Rating is 1..5; comment is optional.
CREATE TABLE IF NOT EXISTS agent_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid        NOT NULL REFERENCES agent_purchases(id) ON DELETE CASCADE,
  agent_id    varchar(64) NOT NULL,                                  -- ide_agents.id by value (no FK; mirrors agent_purchases)
  tenant_id   integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rating      smallint    NOT NULL,                                  -- 1..5
  comment     text,
  created_at  timestamp   NOT NULL DEFAULT now(),
  CONSTRAINT agent_feedback_rating_range CHECK (rating BETWEEN 1 AND 5)
);

-- One feedback row per (tenant, purchase) — a buyer's rating is a single,
-- updatable signal, not an append log; re-submitting overwrites via UPSERT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_feedback_purchase
  ON agent_feedback (purchase_id);

-- Owner-side rollup reads all feedback for one agent, newest first.
CREATE INDEX IF NOT EXISTS idx_agent_feedback_agent
  ON agent_feedback (agent_id, created_at DESC);
