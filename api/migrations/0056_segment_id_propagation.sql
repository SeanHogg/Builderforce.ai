-- Migration: segment_id propagation onto business-entity tables.
--
-- Adds a NOT NULL segment_id (FK -> segments, ON DELETE CASCADE) to every
-- business entity and backfills each existing row to its tenant's DEFAULT
-- segment (created in 0054). Segment deletion (DSR/GDPR erasure) cascades.
--
-- Each table's changes are guarded by to_regclass(): some legacy tables were
-- created via drizzle-kit push and may be absent in a given environment; the
-- guard makes this migration safe everywhere and idempotent on re-run. The
-- literal ALTER ... ADD COLUMN segment_id statement is kept (inside the guard)
-- so the schema-drift checker records the column.
--
-- Ordering per table: ADD COLUMN -> CREATE TRIGGER -> backfill -> SET NOT NULL,
-- so the column is never NOT NULL without the default-fill trigger in place.
--
-- Platform/infra tables (llm_usage_log, llm_traces, tenant_api_keys, auth/admin/
-- RBAC, marketplace/global) intentionally stay tenant-level — per-segment
-- metering of those is a separate tracked gap.

-- ── Default-segment fill trigger functions (centralize the invariant; DRY) ────
-- On an insert that omits segment_id: a 'single' tenant gets its default
-- segment; a 'segmented' tenant RAISEs (the end-client segment must be resolved
-- explicitly) — the no-bleed hard rule enforced at the DB layer. This is why the
-- Drizzle segment_id column is optional in TS yet NOT NULL in the database.

CREATE OR REPLACE FUNCTION set_default_segment_id() RETURNS trigger AS $$
DECLARE v_mode text; v_seg uuid;
BEGIN
  IF NEW.segment_id IS NULL THEN
    SELECT isolation_mode INTO v_mode FROM tenants WHERE id = NEW.tenant_id;
    IF v_mode = 'segmented' THEN
      RAISE EXCEPTION 'segment_id required: tenant % is segmented (table %)', NEW.tenant_id, TG_TABLE_NAME USING ERRCODE = 'not_null_violation';
    END IF;
    SELECT id INTO v_seg FROM segments WHERE tenant_id = NEW.tenant_id AND is_default;
    NEW.segment_id := v_seg;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_default_segment_id_via_project() RETURNS trigger AS $$
DECLARE v_mode text; v_seg uuid; v_tid integer;
BEGIN
  IF NEW.segment_id IS NULL THEN
    SELECT tenant_id INTO v_tid FROM projects WHERE id = NEW.project_id;
    SELECT isolation_mode INTO v_mode FROM tenants WHERE id = v_tid;
    IF v_mode = 'segmented' THEN
      RAISE EXCEPTION 'segment_id required: tenant % is segmented (table tasks)', v_tid USING ERRCODE = 'not_null_violation';
    END IF;
    SELECT id INTO v_seg FROM segments WHERE tenant_id = v_tid AND is_default;
    NEW.segment_id := v_seg;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_projects_segment ON projects;
    CREATE TRIGGER trg_projects_segment BEFORE INSERT ON projects FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE projects x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE projects ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_segment ON projects(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.agents') IS NOT NULL THEN
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_agents_segment ON agents;
    CREATE TRIGGER trg_agents_segment BEFORE INSERT ON agents FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE agents x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE agents ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_agents_segment ON agents(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.coderclaw_instances') IS NOT NULL THEN
    ALTER TABLE coderclaw_instances ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_coderclaw_instances_segment ON coderclaw_instances;
    CREATE TRIGGER trg_coderclaw_instances_segment BEFORE INSERT ON coderclaw_instances FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE coderclaw_instances x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE coderclaw_instances ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_coderclaw_instances_segment ON coderclaw_instances(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.executions') IS NOT NULL THEN
    ALTER TABLE executions ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_executions_segment ON executions;
    CREATE TRIGGER trg_executions_segment BEFORE INSERT ON executions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE executions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE executions ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_executions_segment ON executions(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.source_control_integrations') IS NOT NULL THEN
    ALTER TABLE source_control_integrations ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_source_control_integrations_segment ON source_control_integrations;
    CREATE TRIGGER trg_source_control_integrations_segment BEFORE INSERT ON source_control_integrations FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE source_control_integrations x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE source_control_integrations ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_source_control_integrations_segment ON source_control_integrations(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.specs') IS NOT NULL THEN
    ALTER TABLE specs ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_specs_segment ON specs;
    CREATE TRIGGER trg_specs_segment BEFORE INSERT ON specs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE specs x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE specs ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_specs_segment ON specs(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.workflows') IS NOT NULL THEN
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_workflows_segment ON workflows;
    CREATE TRIGGER trg_workflows_segment BEFORE INSERT ON workflows FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE workflows x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE workflows ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_workflows_segment ON workflows(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.chat_sessions') IS NOT NULL THEN
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_chat_sessions_segment ON chat_sessions;
    CREATE TRIGGER trg_chat_sessions_segment BEFORE INSERT ON chat_sessions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE chat_sessions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE chat_sessions ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_segment ON chat_sessions(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.chat_messages') IS NOT NULL THEN
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_chat_messages_segment ON chat_messages;
    CREATE TRIGGER trg_chat_messages_segment BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE chat_messages x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE chat_messages ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_chat_messages_segment ON chat_messages(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.brain_chats') IS NOT NULL THEN
    ALTER TABLE brain_chats ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_brain_chats_segment ON brain_chats;
    CREATE TRIGGER trg_brain_chats_segment BEFORE INSERT ON brain_chats FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE brain_chats x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE brain_chats ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_brain_chats_segment ON brain_chats(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.chat_memories') IS NOT NULL THEN
    ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_chat_memories_segment ON chat_memories;
    CREATE TRIGGER trg_chat_memories_segment BEFORE INSERT ON chat_memories FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE chat_memories x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE chat_memories ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_chat_memories_segment ON chat_memories(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_memories') IS NOT NULL THEN
    ALTER TABLE project_memories ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_project_memories_segment ON project_memories;
    CREATE TRIGGER trg_project_memories_segment BEFORE INSERT ON project_memories FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE project_memories x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE project_memories ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_project_memories_segment ON project_memories(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ide_project_chats') IS NOT NULL THEN
    ALTER TABLE ide_project_chats ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_ide_project_chats_segment ON ide_project_chats;
    CREATE TRIGGER trg_ide_project_chats_segment BEFORE INSERT ON ide_project_chats FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE ide_project_chats x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE ide_project_chats ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ide_project_chats_segment ON ide_project_chats(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.cron_jobs') IS NOT NULL THEN
    ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_cron_jobs_segment ON cron_jobs;
    CREATE TRIGGER trg_cron_jobs_segment BEFORE INSERT ON cron_jobs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE cron_jobs x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE cron_jobs ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cron_jobs_segment ON cron_jobs(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.approvals') IS NOT NULL THEN
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_approvals_segment ON approvals;
    CREATE TRIGGER trg_approvals_segment BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE approvals x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE approvals ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_approvals_segment ON approvals(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_approval_rules_segment ON approval_rules;
    CREATE TRIGGER trg_approval_rules_segment BEFORE INSERT ON approval_rules FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE approval_rules x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE approval_rules ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_approval_rules_segment ON approval_rules(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.integration_credentials') IS NOT NULL THEN
    ALTER TABLE integration_credentials ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_integration_credentials_segment ON integration_credentials;
    CREATE TRIGGER trg_integration_credentials_segment BEFORE INSERT ON integration_credentials FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE integration_credentials x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE integration_credentials ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_integration_credentials_segment ON integration_credentials(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.integration_sync_logs') IS NOT NULL THEN
    ALTER TABLE integration_sync_logs ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_integration_sync_logs_segment ON integration_sync_logs;
    CREATE TRIGGER trg_integration_sync_logs_segment BEFORE INSERT ON integration_sync_logs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE integration_sync_logs x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE integration_sync_logs ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_segment ON integration_sync_logs(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.contributors') IS NOT NULL THEN
    ALTER TABLE contributors ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_contributors_segment ON contributors;
    CREATE TRIGGER trg_contributors_segment BEFORE INSERT ON contributors FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE contributors x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE contributors ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_contributors_segment ON contributors(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.contributor_identities') IS NOT NULL THEN
    ALTER TABLE contributor_identities ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_contributor_identities_segment ON contributor_identities;
    CREATE TRIGGER trg_contributor_identities_segment BEFORE INSERT ON contributor_identities FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE contributor_identities x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE contributor_identities ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_contributor_identities_segment ON contributor_identities(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.activity_events') IS NOT NULL THEN
    ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_activity_events_segment ON activity_events;
    CREATE TRIGGER trg_activity_events_segment BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE activity_events x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE activity_events ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_activity_events_segment ON activity_events(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.contributor_daily_metrics') IS NOT NULL THEN
    ALTER TABLE contributor_daily_metrics ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_contributor_daily_metrics_segment ON contributor_daily_metrics;
    CREATE TRIGGER trg_contributor_daily_metrics_segment BEFORE INSERT ON contributor_daily_metrics FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE contributor_daily_metrics x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE contributor_daily_metrics ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_contributor_daily_metrics_segment ON contributor_daily_metrics(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.dev_teams') IS NOT NULL THEN
    ALTER TABLE dev_teams ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_dev_teams_segment ON dev_teams;
    CREATE TRIGGER trg_dev_teams_segment BEFORE INSERT ON dev_teams FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE dev_teams x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE dev_teams ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dev_teams_segment ON dev_teams(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.report_schedules') IS NOT NULL THEN
    ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_report_schedules_segment ON report_schedules;
    CREATE TRIGGER trg_report_schedules_segment BEFORE INSERT ON report_schedules FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE report_schedules x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE report_schedules ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_report_schedules_segment ON report_schedules(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.report_subscriptions') IS NOT NULL THEN
    ALTER TABLE report_subscriptions ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_report_subscriptions_segment ON report_subscriptions;
    CREATE TRIGGER trg_report_subscriptions_segment BEFORE INSERT ON report_subscriptions FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE report_subscriptions x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE report_subscriptions ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_report_subscriptions_segment ON report_subscriptions(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.team_memory') IS NOT NULL THEN
    ALTER TABLE team_memory ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_team_memory_segment ON team_memory;
    CREATE TRIGGER trg_team_memory_segment BEFORE INSERT ON team_memory FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE team_memory x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE team_memory ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_team_memory_segment ON team_memory(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.project_insight_events') IS NOT NULL THEN
    ALTER TABLE project_insight_events ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_project_insight_events_segment ON project_insight_events;
    CREATE TRIGGER trg_project_insight_events_segment BEFORE INSERT ON project_insight_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE project_insight_events x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE project_insight_events ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_project_insight_events_segment ON project_insight_events(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.claw_projects') IS NOT NULL THEN
    ALTER TABLE claw_projects ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_claw_projects_segment ON claw_projects;
    CREATE TRIGGER trg_claw_projects_segment BEFORE INSERT ON claw_projects FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE claw_projects x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE claw_projects ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_claw_projects_segment ON claw_projects(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.claw_directories') IS NOT NULL THEN
    ALTER TABLE claw_directories ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_claw_directories_segment ON claw_directories;
    CREATE TRIGGER trg_claw_directories_segment BEFORE INSERT ON claw_directories FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE claw_directories x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE claw_directories ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_claw_directories_segment ON claw_directories(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.claw_directory_files') IS NOT NULL THEN
    ALTER TABLE claw_directory_files ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_claw_directory_files_segment ON claw_directory_files;
    CREATE TRIGGER trg_claw_directory_files_segment BEFORE INSERT ON claw_directory_files FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE claw_directory_files x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE claw_directory_files ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_claw_directory_files_segment ON claw_directory_files(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.claw_sync_history') IS NOT NULL THEN
    ALTER TABLE claw_sync_history ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_claw_sync_history_segment ON claw_sync_history;
    CREATE TRIGGER trg_claw_sync_history_segment BEFORE INSERT ON claw_sync_history FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE claw_sync_history x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE claw_sync_history ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_claw_sync_history_segment ON claw_sync_history(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.usage_snapshots') IS NOT NULL THEN
    ALTER TABLE usage_snapshots ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_usage_snapshots_segment ON usage_snapshots;
    CREATE TRIGGER trg_usage_snapshots_segment BEFORE INSERT ON usage_snapshots FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE usage_snapshots x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE usage_snapshots ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_usage_snapshots_segment ON usage_snapshots(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.tool_audit_events') IS NOT NULL THEN
    ALTER TABLE tool_audit_events ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_tool_audit_events_segment ON tool_audit_events;
    CREATE TRIGGER trg_tool_audit_events_segment BEFORE INSERT ON tool_audit_events FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE tool_audit_events x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE tool_audit_events ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tool_audit_events_segment ON tool_audit_events(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.telemetry_spans') IS NOT NULL THEN
    ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_telemetry_spans_segment ON telemetry_spans;
    CREATE TRIGGER trg_telemetry_spans_segment BEFORE INSERT ON telemetry_spans FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
    UPDATE telemetry_spans x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;
    ALTER TABLE telemetry_spans ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_telemetry_spans_segment ON telemetry_spans(segment_id);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES segments(id) ON DELETE CASCADE;
    DROP TRIGGER IF EXISTS trg_tasks_segment ON tasks;
    CREATE TRIGGER trg_tasks_segment BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION set_default_segment_id_via_project();
    UPDATE tasks x SET segment_id = s.id FROM projects p JOIN segments s ON s.tenant_id = p.tenant_id AND s.is_default WHERE x.project_id = p.id AND x.segment_id IS NULL;
    ALTER TABLE tasks ALTER COLUMN segment_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_segment ON tasks(segment_id);
  END IF;
END $$;

