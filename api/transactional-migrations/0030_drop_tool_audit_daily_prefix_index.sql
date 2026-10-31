-- 0030 · Drop the prefix-redundant idx_tool_audit_daily_tenant_day on the operational track (contract).
--
-- Operational twin of the core drop in migrations/1287: idx_tool_audit_daily_tenant_day (tenant_id, day), created by 0013, is an exact
-- leading prefix of uq_tool_audit_daily_grain (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref), a plain UNIQUE
-- btree also created by 0013 on this track and never altered or dropped since. Every query the narrower index served is served by
-- the unique one, and the Drizzle declaration for it was removed, so this track is the last place it exists. Nothing names an index
-- by name. A plain DROP INDEX takes ACCESS EXCLUSIVE on tool_audit_daily until COMMIT; migrate.mjs runs this file as one
-- transaction, so `SET LOCAL lock_timeout` bounds the wait and a timeout rolls the file back and fails the deploy cleanly (re-run it).
-- Reversible by re-running its CREATE INDEX from 0013.
SET LOCAL lock_timeout = '3s';

DROP INDEX IF EXISTS idx_tool_audit_daily_tenant_day;
