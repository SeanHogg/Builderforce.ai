-- Migration 0080: activatable workflow triggers + cloud run target.
--
-- Closes the Consolidated Gap Register entry "Workflow trigger config is
-- collected by the builder but never acted on by the orchestrator". Until now a
-- saved workflow only ran via the explicit POST .../run endpoint and only on a
-- self-hosted agentHost. This migration adds:
--
--   1. workflows.runtime + cloud_agent_ref, and makes agent_host_id nullable, so
--      a run can target the builderforce-hosted cloud runtime instead of a host.
--   2. workflow_definitions run-target columns — the builder's run-target
--      selector (host OR cloud agent) is persisted so trigger-fired runs know
--      where to execute.
--   3. workflow_triggers — the materialized registry of schedule/webhook/rss/
--      inbound-email triggers, re-synced from each definition on every save.
--      The scheduler cron reads schedule+rss rows by next_run_at; the public
--      webhook + inbound-email entrypoints address rows by token.
--
-- Idempotent (IF NOT EXISTS / DROP NOT NULL is a no-op when already nullable).

-- 1. workflows: cloud run target -------------------------------------------------
ALTER TABLE workflows ALTER COLUMN agent_host_id DROP NOT NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS runtime        varchar(16) NOT NULL DEFAULT 'host';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS cloud_agent_ref varchar(64);

-- 2. workflow_definitions: persisted run target ---------------------------------
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS run_target_runtime        varchar(16) NOT NULL DEFAULT 'host';
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS run_target_agent_host_id  integer REFERENCES agent_hosts(id) ON DELETE SET NULL;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS run_target_cloud_agent_ref varchar(64);

-- 3. workflow_triggers ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      uuid REFERENCES segments(id) ON DELETE CASCADE,
  definition_id   uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  node_id         varchar(128) NOT NULL,
  trigger_type    varchar(32) NOT NULL,
  enabled         boolean NOT NULL DEFAULT TRUE,
  config          text NOT NULL DEFAULT '{}',
  runtime         varchar(16) NOT NULL DEFAULT 'host',
  agent_host_id   integer REFERENCES agent_hosts(id) ON DELETE SET NULL,
  cloud_agent_ref varchar(64),
  token           varchar(64) UNIQUE,
  secret          varchar(128),
  next_run_at     timestamp,
  cursor          text,
  last_run_at     timestamp,
  last_status     varchar(32),
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

-- Hot paths: the scheduler sweeps enabled schedule/rss rows by due time; the
-- webhook/email entrypoints look up by token (already covered by the UNIQUE
-- index); definition re-sync deletes by definition_id.
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_due
  ON workflow_triggers (next_run_at)
  WHERE enabled = TRUE AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_definition
  ON workflow_triggers (definition_id);
