-- Unify the legacy audit_events subsystem into the single activity_log stream.
--
-- Before: TWO overlapping trails — audit_events (userId-only actor, enum eventType;
-- written by Auth/Agent/Runtime services + task routes, read by /api/audit, the
-- audit.list MCP tool and the engagement metric) AND activity_log (mig 0287, the
-- polymorphic who-did-what-to-what timeline). After: activity_log is the ONE store.
-- The AuditRepository is now an adapter that writes/reads activity_log, so the
-- /api/audit endpoint and the /logs page keep working with no schema of their own.
--
-- 1) activity_log.tenant_id becomes nullable so a platform-global event (a pre-tenant
--    login / registration, which audit_events allowed with a null tenant) still fits.
ALTER TABLE activity_log ALTER COLUMN tenant_id DROP NOT NULL;

-- 2) Carry existing audit_events rows over so the /logs history isn't lost. eventType
--    'user_login' → verb 'user.login'; the actor is the human who acted (userId) or
--    'system' when null; resource_type/id map to target_type/id; metadata (text JSON)
--    is preserved under {"raw": …} (a lossless, cast-safe move — new rows write proper
--    jsonb via the emitter). Guarded on the table existing (fresh DBs never had it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events') THEN
    INSERT INTO activity_log (tenant_id, actor_type, actor_ref, verb, target_type, target_id, metadata, occurred_at, created_at)
    SELECT
      ae.tenant_id,
      CASE WHEN ae.user_id IS NULL THEN 'system' ELSE 'human' END,
      ae.user_id,
      replace(ae.event_type::text, '_', '.'),
      ae.resource_type,
      ae.resource_id,
      CASE WHEN ae.metadata IS NULL THEN NULL ELSE jsonb_build_object('raw', ae.metadata) END,
      ae.created_at,
      ae.created_at
    FROM audit_events ae;
  END IF;
END $$;

-- 3) Retire the legacy table + its enum (no other table uses audit_event_type).
DROP TABLE IF EXISTS audit_events;
DROP TYPE IF EXISTS audit_event_type;
