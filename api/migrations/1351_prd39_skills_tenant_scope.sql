-- 1351 · PRD 39 §3 Push 1 — give `skills` its own tenant scope (EXPAND).
--
-- WHY. `skills` used to inherit tenancy from its NOT NULL ON DELETE CASCADE FK to
-- the legacy `agents` table. Migration 1347 dropped that FK (the table is removed
-- in Push 2), which left `skills` — customer data — with no tenant-scoping column,
-- so no query against it could be checked by `check-tenant-scope`. This adds a
-- real `tenant_id` and backfills it.
--
-- ORDER. Runs after 1347 (adds/backfills `skills.agent_registration_id`) and 1348
-- (folds any `agents` row not yet in `agent_registrations`), so the registration
-- backfill is replayed first to pick up the rows 1348 folded.
--
-- EXPAND. The column is nullable: every legacy skill had a tenant through `agents`,
-- and writes to `skills` are closed (the routes return 410), so the backfill below
-- should leave no NULLs — but NOT NULL is held for the contract push, where the
-- `agents` table drop lands, so this deploy cannot fail on a straggler.
SET LOCAL lock_timeout = '3s';

-- 1. The tenant scope column.
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER
  REFERENCES tenants(id) ON DELETE CASCADE;

-- 2. Replay 1347's registration backfill (1348 may have folded more registrations).
UPDATE skills s
SET agent_registration_id = r.id
FROM agent_registrations r
WHERE s.agent_id = r.legacy_agent_id
  AND s.agent_registration_id IS NULL;

-- 3. Backfill the tenant from the canonical owner (the registration)...
UPDATE skills s
SET tenant_id = r.tenant_id
FROM agent_registrations r
WHERE s.agent_registration_id = r.id
  AND s.tenant_id IS NULL;

-- 4. ...and, for any row still unresolved, from the legacy `agents` row it pointed at.
UPDATE skills s
SET tenant_id = a.tenant_id
FROM agents a
WHERE s.agent_id = a.id
  AND s.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_skills_tenant
  ON skills(tenant_id);
