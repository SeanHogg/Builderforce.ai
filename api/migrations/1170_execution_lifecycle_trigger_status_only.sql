-- 1170: the execution lifecycle trigger runs only when a status can have changed.
--
-- 0374's append_execution_lifecycle_event() fired AFTER every UPDATE on `executions`
-- and looked up `tasks.project_id` before checking whether the status changed. Cloud
-- runs heartbeat by updating `executions.updated_at` every few seconds, so every beat ran
-- the function and read `tasks` for nothing. Measured 2026-09-14 on the primary:
-- `executions` 310k writes, `tasks` 16M reads — part of the load that exhausted the
-- Neon compute quota. Behaviour for real transitions is unchanged:
--   1. the trigger fires on INSERT or UPDATE OF status only, so an update that does not
--      set `status` (a heartbeat, a result write) never runs the function;
--   2. an UPDATE that sets `status` to its current value returns before the lookup.

CREATE OR REPLACE FUNCTION append_execution_lifecycle_event()
RETURNS trigger AS $$
DECLARE
  v_project_id integer;
  v_event_type varchar(64);
  v_from_status varchar(32);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO v_project_id FROM tasks WHERE id = NEW.task_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO execution_lifecycle_outbox (
      event_key, tenant_id, execution_id, task_id, project_id,
      lifecycle_version, event_type, from_status, to_status, submitted_by,
      agent_host_id, cloud_agent_ref, mode, payload, occurred_at
    ) VALUES (
      'execution:' || NEW.id || ':v:' || NEW.lifecycle_version || ':submitted',
      NEW.tenant_id, NEW.id, NEW.task_id, v_project_id,
      NEW.lifecycle_version, 'execution.submitted', NULL, NEW.status, NEW.submitted_by,
      NEW.agent_host_id, NEW.cloud_agent_ref, NEW.mode,
      jsonb_build_object('status', NEW.status), NEW.created_at
    ) ON CONFLICT (event_key) DO NOTHING;

    IF NEW.status NOT IN ('pending', 'submitted') THEN
      v_event_type := 'execution.' || NEW.status;
      INSERT INTO execution_lifecycle_outbox (
        event_key, tenant_id, execution_id, task_id, project_id,
        lifecycle_version, event_type, from_status, to_status, submitted_by,
        agent_host_id, cloud_agent_ref, mode, payload, occurred_at
      ) VALUES (
        'execution:' || NEW.id || ':v:' || NEW.lifecycle_version || ':' || NEW.status,
        NEW.tenant_id, NEW.id, NEW.task_id, v_project_id,
        NEW.lifecycle_version, v_event_type, NULL, NEW.status, NEW.submitted_by,
        NEW.agent_host_id, NEW.cloud_agent_ref, NEW.mode,
        jsonb_build_object('status', NEW.status, 'createdInStatus', true),
        coalesce(NEW.started_at, NEW.created_at)
      ) ON CONFLICT (event_key) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  v_from_status := OLD.status;
  v_event_type := CASE
    WHEN NEW.status = 'running' AND OLD.status = 'paused' THEN 'execution.resumed'
    ELSE 'execution.' || NEW.status
  END;

  INSERT INTO execution_lifecycle_outbox (
    event_key, tenant_id, execution_id, task_id, project_id,
    lifecycle_version, event_type, from_status, to_status, submitted_by,
    agent_host_id, cloud_agent_ref, mode, payload, occurred_at
  ) VALUES (
    'execution:' || NEW.id || ':v:' || NEW.lifecycle_version || ':' || NEW.status,
    NEW.tenant_id, NEW.id, NEW.task_id, v_project_id,
    NEW.lifecycle_version, v_event_type, v_from_status, NEW.status, NEW.submitted_by,
    NEW.agent_host_id, NEW.cloud_agent_ref, NEW.mode,
    jsonb_build_object(
      'status', NEW.status,
      'errorMessage', NEW.error_message,
      'hasResult', NEW.result IS NOT NULL
    ),
    CASE
      WHEN NEW.status IN ('completed', 'failed', 'cancelled') THEN coalesce(NEW.completed_at, now())
      WHEN NEW.status = 'running' THEN coalesce(NEW.started_at, now())
      ELSE now()
    END
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_lifecycle_outbox ON executions;
CREATE TRIGGER trg_execution_lifecycle_outbox
  AFTER INSERT OR UPDATE OF status ON executions
  FOR EACH ROW
  EXECUTE FUNCTION append_execution_lifecycle_event();
