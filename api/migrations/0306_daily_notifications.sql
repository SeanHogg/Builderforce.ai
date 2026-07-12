-- Daily PM/Lead Notification System
-- 
-- FR2: Configurable Send Time (default 08:50 UTC)
-- FR3: User Role-Based Preferences (PM/Lead roles)
-- FR4: Notification Content Generation (new/changed tasks last 24h)
-- FR5: Multi-Channel Delivery (email + in-app)
-- FR6: Deduplication Logic (persist references to avoid re-notification)
--
-- Tables:
--   1. task_notifications: Tracks delivered notifications for users
--   2. notification_preferences: PM/Lead user config
--   3. task_change_events: Snapshot task changes (for 24h window)
--   4. cron_job: Scheduled daily notification task

-- 1. Task Notification History (deduplication)
CREATE TABLE IF NOT EXISTS task_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       VARCHAR NOT NULL, -- users.id
  notification_kind VARCHAR(50) NOT NULL, -- 'pm_daily', 'lead_daily', etc.
  sent_at       TIMESTAMP NOT NULL DEFAULT now(),
  scheduled_at  TIMESTAMP NOT NULL,
  window_start  TIMESTAMP NOT NULL, -- 24h coverage window
  window_end    TIMESTAMP NOT NULL,
  summary_title VARCHAR(255) NOT NULL,
  summary_body  TEXT,
  task_count    INTEGER NOT NULL, -- number of tasks included
  channels      JSONB NOT NULL, -- {'email': true, 'in_app': true}
  affected_projects INTEGER[], -- list of project IDs touched
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_tenant_user ON task_notifications(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_scheduled ON task_notifications(scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_notifications_sent ON task_notifications(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_notifications_window ON task_notifications(tenant_id, notification_kind, window_start);

-- 2. User Notification Preferences (FR3)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       VARCHAR NOT NULL UNIQUE, -- users.id
  enabled       BOOLEAN NOT NULL DEFAULT false, -- opted-in
  delivery_channels JSONB NOT NULL DEFAULT '{"email": true, "in_app": true}', -- {email: boolean, in_app: boolean, slack: false}
  notification_kind VARCHAR(50) NOT NULL, -- 'pm_daily' | 'lead_daily'
  send_time_utc VARCHAR(10) NOT NULL DEFAULT '08:50', -- HH:MM format (FR2)
  timezone     VARCHAR(100) NOT NULL DEFAULT 'UTC', -- user timezone for AC1 (local time before 9AM)
  priority_filter JSONB, -- {'high': true, 'medium': true} - filter by priority
  include_archived BOOLEAN NOT NULL DEFAULT false,
  max_tasks INTEGER NOT NULL DEFAULT 20, -- limit per notification to prevent overload
  active       BOOLEAN NOT NULL DEFAULT true, -- can be temporarily disabled
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant ON notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_kind ON notification_preferences(notification_kind);

-- 3. Task Change Events (FR4)
CREATE TABLE IF NOT EXISTS task_change_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       VARCHAR NOT NULL, -- user who caused the change (optional)
  event_type    VARCHAR(50) NOT NULL, -- 'created', 'updated', 'moved', 'status_change', 'assign_change'
  pre_snapshot  JSONB NOT NULL, -- task state before change
  post_snapshot JSONB NOT NULL, -- task state after change
  occurred_at   TIMESTAMP NOT NULL,
  window_start  TIMESTAMP, -- which 24h window this belongs to
  window_end    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_change_events_tenant ON task_change_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_change_events_window ON task_change_events(tenant_id, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_task_change_events_project ON task_change_events(project_id);
CREATE INDEX IF NOT EXISTS idx_task_change_events_task ON task_change_events(task_id);

-- 4. Cron Job for Daily Notifications (FR1)
INSERT INTO cron_jobs (tenant_id, claw_id, project_id, name, schedule, enabled)
SELECT 
  t.id as tenant_id,
  c.id as claw_id,
  NULL as project_id,
  'daily_pm_lead_notification' as name,
  '0 50 8 * * *' as schedule, -- CRON: 08:50 UTC every day (FR2)
  true as enabled
FROM tenants t
JOIN coderclaw_instances c ON c.type = 'runs' AND c.is_builtin = true
WHERE NOT EXISTS -- avoid duplicate insertions
  (SELECT 1 FROM cron_jobs WHERE name = 'daily_pm_lead_notification')
ON CONFLICT DO NOTHING;