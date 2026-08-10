-- 0437_ticket_memory_lifecycle.sql
--
-- Ticket-scoped memory uses the governed memory primitive's polymorphic
-- (scope_kind, scope_id) key. A conventional FK cannot be conditional on
-- scope_kind, so enforce the same ownership/lifecycle invariant with triggers:
-- ticket memories must name a ticket in the same tenant, and deleting the ticket
-- reclaims those memories immediately. Project/tenant scopes are unaffected.

CREATE OR REPLACE FUNCTION validate_ticket_scoped_agent_memory()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scope_kind = 'ticket' AND NOT EXISTS (
    SELECT 1
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
     WHERE t.id = NEW.scope_id
       AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'ticket-scoped agent_memory must reference a ticket in the same tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_memory_ticket_scope ON agent_memory;
CREATE TRIGGER trg_agent_memory_ticket_scope
BEFORE INSERT OR UPDATE OF tenant_id, scope_kind, scope_id ON agent_memory
FOR EACH ROW EXECUTE FUNCTION validate_ticket_scoped_agent_memory();

CREATE OR REPLACE FUNCTION delete_ticket_scoped_agent_memory()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM agent_memory
   WHERE scope_kind = 'ticket'
     AND scope_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_delete_agent_memory ON tasks;
CREATE TRIGGER trg_tasks_delete_agent_memory
AFTER DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION delete_ticket_scoped_agent_memory();

-- Remove historical orphans before the invariant becomes relied upon. Tenant
-- ownership is checked through tasks.project_id -> projects.tenant_id.
DELETE FROM agent_memory am
 WHERE am.scope_kind = 'ticket'
   AND NOT EXISTS (
     SELECT 1
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = am.scope_id
        AND p.tenant_id = am.tenant_id
   );
