-- 1288 · Drop prefix-redundant indexes on the HOT tables.
--
-- Second of three files split from the operator-approved (2026-10-31) index clean-up (see 1287 for the full rationale; the
-- prefix-redundancy argument there applies unchanged to every drop below). 5 indexes, on the busiest tables, kept in their own
-- file so their ACCESS EXCLUSIVE locks are held for as short a transaction as possible: tasks, objects, llm_usage_log,
-- agent_memory, brain_chats. (`executions` was reviewed as hot and has no prefix-redundant index, so there is nothing to drop.)
-- With 1287's 56 this makes the 61 B drops.
--
-- LOCKS. A plain DROP INDEX takes ACCESS EXCLUSIVE on its table until COMMIT, and scripts/migrate.mjs runs each file as ONE
-- transaction (sql.transaction over the Neon HTTP transport: BEGIN, every statement, the ledger INSERT, COMMIT). `SET LOCAL
-- lock_timeout` is the first statement of that transaction, so it bounds every lock wait in this file to 3s and reverts at COMMIT.
-- If a lock cannot be had in time the statement errors, the whole file rolls back (nothing half-applied, no ledger row), the
-- deploy fails cleanly BEFORE the Worker deploys, and the fix is to re-run the deploy.
--
-- WHY IT IS SAFE
--   B. Each dropped index S is a plain btree on plain columns (no expression, INCLUDE or WHERE), NOT unique and backing no
--      constraint, whose key columns, order and per-column sort options are an exact leading prefix of a strictly longer
--      plain btree index L on the same table. L is left in place, so every query S served is served by L. L may be unique
--      or constraint-backed; the L named beside each drop is the one that survives (no L here is itself dropped). The old
--      Worker only ever names columns, never an index name, so it is unaffected. The set was derived by replaying
--      api/migrations in order (CREATE/DROP INDEX, index and table renames incl. 0078's claw → agent_host, DROP COLUMN,
--      inline and ALTER constraints), not from the Drizzle schema. Tables served by the apps database, and any index
--      whose replay was ambiguous (created inside a to_regclass-guarded block before its table existed), are excluded.
--
-- REVERSIBLE: every dropped index is re-created by its original CREATE INDEX (the migration that created it is named in the comment
-- beside the drop). llm_usage_log is dropped here on the CORE copy only — transactional-migrations is a different database.

SET LOCAL lock_timeout = '3s';

-- ── B (hot tables). Prefix-redundant indexes (dropped index → surviving covering index) ───────────────────────

-- agent_memory
DROP INDEX IF EXISTS agent_memory_tenant_idx;   -- (tenant_id) ⊂ agent_memory_scope_key_uq (tenant_id, scope_kind, scope_id, key)  [created 0200_agent_memory]

-- brain_chats
DROP INDEX IF EXISTS idx_ide_project_chats_tenant_id;   -- (tenant_id) ⊂ idx_brain_chats_tenant_mode (tenant_id, mode, created_at DESC)  [created 0025_ide_project_chats]

-- llm_usage_log
DROP INDEX IF EXISTS idx_llm_usage_tenant_id;   -- (tenant_id) ⊂ idx_llm_usage_agent_host (tenant_id, agent_host_id, created_at DESC)  [created 0008_tenant_subscriptions_and_usage_scope]

-- objects
DROP INDEX IF EXISTS idx_objects_tenant_kind;   -- (tenant_id, kind) ⊂ uq_objects_ref (tenant_id, kind, ref_id)  [created 0418_kernel_primitives]

-- tasks
-- (tenant_id) ⊂ idx_tasks_tenant_project (tenant_id, project_id)  [created 0944_tasks_tenant_id]
DROP INDEX IF EXISTS idx_tasks_tenant;
