-- Migration: 0017_feature_gaps
-- Implements P0-1, P0-2, P1-1, P1-2, P2-2, P2-3, P2-4, P3-3 feature gaps.

-- ---------------------------------------------------------------------------
-- P2-3: Fleet Capability Management
-- Add declared_capabilities column to coderclaw_instances
-- ---------------------------------------------------------------------------
ALTER TABLE coderclaw_instances
  ADD COLUMN IF NOT EXISTS declared_capabilities text;

-- ---------------------------------------------------------------------------
-- P1-1: Specs table
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE spec_status AS ENUM ('draft', 'reviewed', 'approved', 'in_progress', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS specs (
  id           uuid PRIMARY KEY,
  tenant_id    int  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   int  REFERENCES projects(id) ON DELETE SET NULL,
  claw_id      int  REFERENCES coderclaw_instances(id) ON DELETE SET NULL,
  goal         text NOT NULL,
  status       spec_status NOT NULL DEFAULT 'draft',
  prd          text,
  arch_spec    text,
  task_list    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- P1-2: Workflows and workflow_tasks tables
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE workflow_type AS ENUM ('feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_task_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workflows (
  id            uuid PRIMARY KEY,
  tenant_id     int  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id       int  NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  spec_id       uuid REFERENCES specs(id) ON DELETE SET NULL,
  workflow_type workflow_type NOT NULL DEFAULT 'custom',
  status        workflow_status NOT NULL DEFAULT 'pending',
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id           uuid PRIMARY KEY,
  workflow_id  uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  agent_role   varchar(255) NOT NULL,
  description  text NOT NULL,
  status       workflow_task_status NOT NULL DEFAULT 'pending',
  input        text,
  output       text,
  error        text,
  depends_on   text,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- P2-2: Usage snapshots table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id                serial PRIMARY KEY,
  tenant_id         int    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id           int    NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  session_key       varchar(255) NOT NULL,
  input_tokens      int    NOT NULL DEFAULT 0,
  output_tokens     int    NOT NULL DEFAULT 0,
  context_tokens    int    NOT NULL DEFAULT 0,
  context_window_max int   NOT NULL DEFAULT 0,
  compaction_count  int    NOT NULL DEFAULT 0,
  ts                timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- P2-4: Tool audit events table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_audit_events (
  id           serial PRIMARY KEY,
  tenant_id    int  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id      int  NOT NULL REFERENCES coderclaw_instances(id) ON DELETE CASCADE,
  run_id       varchar(255),
  session_key  varchar(255),
  tool_call_id varchar(255),
  tool_name    varchar(255) NOT NULL,
  category     varchar(100),
  args         text,
  result       text,
  duration_ms  int,
  ts           timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- P3-3: Approvals table
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS approvals (
  id           uuid PRIMARY KEY,
  tenant_id    int  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claw_id      int  REFERENCES coderclaw_instances(id) ON DELETE SET NULL,
  requested_by varchar(36),
  action_type  varchar(255) NOT NULL,
  description  text NOT NULL,
  metadata     text,
  status       approval_status NOT NULL DEFAULT 'pending',
  reviewed_by  varchar(36),
  review_note  text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
