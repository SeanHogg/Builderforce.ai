-- 0321_drop_ide_agents_engine.sql
--
-- Drop the vestigial `ide_agents.engine` column (added in 0087, retired in spirit by
-- the engine consolidation to a single CURRENT_ENGINE_ID). It was never read from the
-- DB for any behaviour — the runtime resolves the engine from the CURRENT_ENGINE_ID
-- constant at run time and merely echoed a denormalized copy on observability payloads.
-- All writers (workforce create/update raw SQL + the cloud_agents.create MCP tool) and
-- the Drizzle schema field have been removed in the same pass, so nothing references it.
ALTER TABLE ide_agents DROP COLUMN IF EXISTS engine;
