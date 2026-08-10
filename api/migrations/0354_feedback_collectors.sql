-- 0354_feedback_collectors.sql
--
-- Product Feedback collection — the second "collector" pillar, mirroring the
-- Quality error collectors (0250) but for HUMAN input rather than machine errors.
--
-- A feedback collector is configured at the PROJECT level and rendered as an
-- embeddable snippet, so any application (ours included — this is the dogfooding
-- surface) can gather feature requests, bug reports and ideas from its own users.
--
-- Every submission opens a board ticket in the backlog marked `source='feedback'`
-- — an EXTERNAL REQUEST. Such a ticket is HARD-GATED from autonomous execution:
-- evaluateTaskAutoRun short-circuits on `source='feedback'` before any lane/agent
-- resolution, so no dispatch path (lane trigger, mechanical sweep, manager pass,
-- even manual Run-now) can start an agent on it. A human approving the request in
-- the triage queue flips the marker to `feedback_approved`, and only then does the
-- ticket behave like ordinary work.

-- ---------------------------------------------------------------------------
-- feedback_collectors — ONE per project (one ingest key = one embeddable snippet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_collectors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  -- SHA-256 of the bff_* ingest key (the raw key is shown once, at creation).
  key_hash            VARCHAR(64) UNIQUE,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  -- Open a backlog ticket per submission. When false the submission is still
  -- recorded and triageable, it just does not put a card on the board yet.
  auto_create_task    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Abuse ceiling: submissions accepted from this collector per rolling 24h.
  -- A public unauthenticated endpoint that creates TICKETS needs a hard cap.
  daily_limit         INTEGER NOT NULL DEFAULT 100,
  -- Origins the snippet may post from ('*' or a comma-separated allow-list).
  allowed_origins     TEXT NOT NULL DEFAULT '*',
  last_submission_at  TIMESTAMP,
  created_by          VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One collector per project — the same "one key, one snippet" rule the error
-- collectors follow, so a project's feedback has a single front door.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_collectors_project
  ON feedback_collectors (tenant_id, project_id);

-- ---------------------------------------------------------------------------
-- feedback_submissions — the raw request, and its link to the opened ticket
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL for an IN-APP submission (the signed-in right-edge feedback panel),
  -- which is authenticated by the session and needs no ingest key.
  collector_id      UUID REFERENCES feedback_collectors(id) ON DELETE SET NULL,
  -- 'feature' | 'bug' | 'idea' | 'other'
  kind              VARCHAR(16) NOT NULL DEFAULT 'feature',
  title             VARCHAR(300) NOT NULL,
  body              TEXT NOT NULL,
  -- 'new' | 'approved' | 'declined'
  status            VARCHAR(16) NOT NULL DEFAULT 'new',
  -- Who asked. submitter_user_id is set only for in-app submissions; the
  -- snippet path carries whatever contact detail the widget collected.
  submitter_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  submitter_email   VARCHAR(255),
  submitter_name    VARCHAR(255),
  -- Provenance from the embedding page (URL, UA, app release) so a request can
  -- be reproduced and attributed to a build.
  page_url          TEXT,
  user_agent        TEXT,
  app_version       VARCHAR(64),
  context           JSONB,
  -- SHA-256 of kind+title+body — collapses a double-submit / repeat request
  -- onto the existing open submission instead of a duplicate ticket.
  fingerprint       VARCHAR(128) NOT NULL,
  -- The backlog ticket opened for this request (NULL when auto_create_task is off).
  task_id           INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  reviewed_by       VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Triage queue read: newest-first within a project.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_project
  ON feedback_submissions (project_id, created_at DESC);
-- Superadmin cross-tenant roll-up + the per-status counts.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_tenant_status
  ON feedback_submissions (tenant_id, status, created_at DESC);
-- Backs BOTH the rolling-24h rate cap and the duplicate collapse.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_collector
  ON feedback_submissions (collector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_fingerprint
  ON feedback_submissions (project_id, fingerprint);
