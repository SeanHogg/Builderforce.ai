-- 1348 · PRD 39 §3 Push 1 — keep `agent_registrations.legacy_agent_id` aligned with
-- the numeric legacy id clients still send to /api/agents.
--
-- WHY. `/api/agents` is served from `agent_registrations` with id = legacy_agent_id
-- (migration 0394 folded the rows; 1347 re-pointed the routes and dropped the FKs).
-- The `agents` table is now read by nothing, so a NEW registration that does not
-- claim a legacy id would leave a hole in the numeric surface old clients read.
-- This idempotent guard folds any `agents` row not yet represented in
-- `agent_registrations` and stamps `legacy_agent_id` on any registration row that
-- still lacks it but owns the name (the UNIQUE (tenant_id, lower(name)) index makes
-- the name the ownership key). Runs safely on every deploy; the checks keep it a
-- no-op once the legacy table is emptied and the column is fully backfilled.

-- 1. Fold any legacy agents row that has no registration yet.
INSERT INTO agent_registrations (
  tenant_id, segment_id, legacy_agent_id, name, framework, protocol, endpoint,
  external_agent_id, status, health_status, discovered_capabilities, metadata,
  created_at, updated_at
)
SELECT
  a.tenant_id,
  a.segment_id,
  a.id,
  a.name,
  a.type::text,
  'native-http',
  a.endpoint,
  a.id::text,
  CASE WHEN a.is_active THEN 'active' ELSE 'inactive' END,
  'unknown',
  COALESCE(
    (SELECT jsonb_agg(DISTINCT s.name ORDER BY s.name) FROM skills s WHERE s.agent_id = a.id),
    '[]'::jsonb
  ),
  jsonb_build_object('migratedFrom', 'agents', 'legacyConfigPresent', a.config IS NOT NULL),
  a.created_at,
  a.updated_at
FROM agents a
WHERE NOT EXISTS (SELECT 1 FROM agent_registrations r WHERE r.legacy_agent_id = a.id)
ON CONFLICT (legacy_agent_id) DO NOTHING;

-- 2. Claim the legacy id on a registration that owns the name but never got one.
UPDATE agent_registrations r
SET legacy_agent_id = a.id
FROM agents a
WHERE r.legacy_agent_id IS NULL
  AND r.tenant_id = a.tenant_id
  AND lower(r.name) = lower(a.name);
