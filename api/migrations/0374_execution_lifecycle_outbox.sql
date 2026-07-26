-- 0374 — Durable, idempotent execution lifecycle events.
--
-- Every executions writer is covered at the database boundary. The trigger and
-- the execution mutation share a transaction, so a committed execution can no
-- longer exist without a durable event waiting to be projected to activity_log.

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS event_key varchar(160);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_log_event_key
  ON activity_log(event_key);

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS execution_lifecycle_outbox (
  id                bigserial PRIMARY KEY,
  event_key         varchar(160) NOT NULL,
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id      integer NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id           integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id        integer REFERENCES projects(id) ON DELETE SET NULL,
  lifecycle_version integer NOT NULL,
  event_type        varchar(64) NOT NULL,
  from_status       varchar(32),
  to_status         varchar(32) NOT NULL,
  submitted_by      varchar(128) NOT NULL,
  agent_host_id     integer REFERENCES agent_hosts(id) ON DELETE SET NULL,
  cloud_agent_ref   varchar(64),
  mode              varchar(16) NOT NULL DEFAULT 'live',
  payload           jsonb,
  status            varchar(16) NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamp NOT NULL DEFAULT now(),
  last_error        text,
  processed_at      timestamp,
  occurred_at       timestamp NOT NULL DEFAULT now(),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_lifecycle_outbox_event_key
  ON execution_lifecycle_outbox(event_key);
CREATE INDEX IF NOT EXISTS idx_execution_lifecycle_outbox_due
  ON execution_lifecycle_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_execution_lifecycle_outbox_execution
  ON execution_lifecycle_outbox(tenant_id, execution_id, id);

CREATE OR REPLACE FUNCTION bump_execution_lifecycle_version()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.lifecycle_version := OLD.lifecycle_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_lifecycle_version ON executions;
CREATE TRIGGER trg_execution_lifecycle_version
  BEFORE UPDATE ON executions
  FOR EACH ROW
  EXECUTE FUNCTION bump_execution_lifecycle_version();

CREATE OR REPLACE FUNCTION append_execution_lifecycle_event()
RETURNS trigger AS $$
DECLARE
  v_project_id integer;
  v_event_type varchar(64);
  v_from_status varchar(32);
BEGIN
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

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
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
  AFTER INSERT OR UPDATE ON executions
  FOR EACH ROW
  EXECUTE FUNCTION append_execution_lifecycle_event();

-- Existing runs receive one idempotent snapshot so the tenant audit stream can
-- reconcile historical execution rows without manufacturing every old transition.
INSERT INTO execution_lifecycle_outbox (
  event_key, tenant_id, execution_id, task_id, project_id,
  lifecycle_version, event_type, from_status, to_status, submitted_by,
  agent_host_id, cloud_agent_ref, mode, payload, occurred_at
)
SELECT
  'execution:' || e.id || ':v:' || e.lifecycle_version || ':snapshot',
  e.tenant_id, e.id, e.task_id, t.project_id,
  e.lifecycle_version, 'execution.snapshot', NULL, e.status, e.submitted_by,
  e.agent_host_id, e.cloud_agent_ref, e.mode,
  jsonb_build_object('status', e.status, 'historical', true),
  coalesce(e.completed_at, e.started_at, e.created_at)
FROM executions e
JOIN tasks t ON t.id = e.task_id
ON CONFLICT (event_key) DO NOTHING;
