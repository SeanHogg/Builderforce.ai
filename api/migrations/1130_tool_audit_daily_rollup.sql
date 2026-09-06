-- 1130 · `tool_audit_daily` — the daily rollup that replaces aged-out tool-audit rows.
--
-- WHY. `tool_audit_events` was 176 MB of a 431 MB database: 665,010 rows, of which
-- 651,663 are older than 30 days and 211,003 are `auto_run_skipped` from the
-- 2026-07-14 → 2026-08-04 re-dispatch loop. The 90-day window is not negotiable —
-- it is the window the SOC 2 evidence export reads — but the GRAIN is. Every figure
-- the compliance lens and the evidence pack compute (volume, sensitive-action count,
-- per-tool / per-category / per-agent breakdown, duration) is a sum over
-- (tenant, day, tool_name, category, agent). Folding to that grain measured 188:1
-- when it ran: 651,664 raw rows became 3,464 tallies, and the relation went from
-- 176 MB to 11 MB — 163 MB off a 431 MB database.
--
-- WHAT IT COSTS. The ability to cite ONE tool call older than the fold boundary. The
-- three stages are 14d redact → 30d fold → 90d purge, so a row is only ever folded
-- after its `args`/`result` payload has already been blanked — the fold discards a row
-- that had nothing left in it but its dimensions, and the tally keeps those.
--
-- NO FK ON agent_host_id. The raw table cascade-deletes an agent host's events with
-- the host. An audit record a deregistration erases is not an audit record, so the
-- rollup holds the id as a plain value — the call `cloud_agent_ref` already makes.
--
-- NULLS NOT DISTINCT on the grain index. `category`, `agent_host_id` and
-- `cloud_agent_ref` are all nullable and NULL is a real grain value here ("no
-- category"), not an unknown. Without the qualifier every NULL-bearing group would
-- be distinct from itself and the ON CONFLICT re-fold guard would never fire.

CREATE TABLE IF NOT EXISTS tool_audit_daily (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day                 date NOT NULL,
  tool_name           varchar(255) NOT NULL,
  category            varchar(100),
  agent_host_id       integer,
  cloud_agent_ref     varchar(64),
  events              integer NOT NULL,
  distinct_executions integer NOT NULL,
  duration_ms_total   bigint,
  first_ts            timestamp NOT NULL,
  last_ts             timestamp NOT NULL,
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_audit_daily_grain
  ON tool_audit_daily (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref)
  NULLS NOT DISTINCT;

-- The read path: the compliance summary and the evidence pack both scan one tenant
-- over a day window, newest first.
CREATE INDEX IF NOT EXISTS idx_tool_audit_daily_tenant_day
  ON tool_audit_daily (tenant_id, day);

-- Per-table autovacuum tuning, required of every SWEPT_TABLES relation by
-- `npm run check:swept-tables` and for the reason 1104 gives: at the 0.2 default the
-- relation extends instead of reusing pages. This one is also UPDATE-heavy by design
-- — a re-fold adds to an existing tally rather than inserting — so unlike 1125 it
-- takes a fillfactor, leaving room for the HOT updates that keeps off the index.
ALTER TABLE tool_audit_daily SET (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  fillfactor = 85
);
