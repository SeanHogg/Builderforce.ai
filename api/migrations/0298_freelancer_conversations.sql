-- 0298_freelancer_conversations.sql
-- In-platform messaging for the freelance marketplace (Upwork-parity P0 #1).
--
-- Before this, hiring/interviewing/scoping happened off-platform: there was no
-- employer<->freelancer conversation table anywhere (the chat_* tables are Brain/IDE
-- only). This adds a two-party thread scoped to an engagement, a job+proposal, or a
-- direct talent contact, plus its messages. The feed reuses the notification pattern
-- (kind='message') so the recipient always sees new messages in-app.
--
-- Authorization model (enforced in freelancerMessagingRoutes):
--   * Employer side  = the tenant (any manager on it), acting as sender_user_id.
--   * Freelancer side = the specific freelancer_user_id.
-- A message is "from the freelancer" iff sender_user_id = freelancer_user_id, else it
-- is from the employer side — that single comparison drives per-side unread counts.
--
-- Read state is tracked per SIDE (not per message) via two watermark columns, so a
-- thread with many managers on the employer side stays correct: whoever reads on a
-- side advances that side's watermark. Idempotent throughout.

CREATE TABLE IF NOT EXISTS freelancer_conversations (
  id                       VARCHAR(36) PRIMARY KEY,
  tenant_id                INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  freelancer_user_id       VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The manager who opened the thread (employer-side default notify target).
  employer_user_id         VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  -- What the thread hangs off: engagement | job | proposal | direct.
  subject_type             VARCHAR(20) NOT NULL DEFAULT 'direct',
  engagement_id            VARCHAR(36) REFERENCES freelancer_engagements(id) ON DELETE SET NULL,
  job_id                   VARCHAR(36) REFERENCES job_postings(id) ON DELETE SET NULL,
  proposal_id              VARCHAR(36) REFERENCES job_proposals(id) ON DELETE SET NULL,
  project_id               INTEGER,
  title                    VARCHAR(200),
  -- Denormalized last-message cache so the list view renders without a per-row scan.
  last_message_at          TIMESTAMPTZ,
  last_message_preview     VARCHAR(280),
  last_sender_user_id      VARCHAR(36),
  -- Per-side read watermarks (see header).
  employer_last_read_at    TIMESTAMPTZ,
  freelancer_last_read_at  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One thread per (tenant, freelancer, engagement) and per (tenant, freelancer, job)
-- so re-opening a scoped conversation reuses the existing one. A partial unique index
-- keyed on the scope id keeps direct threads (all-null scope) unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fl_conv_engagement
  ON freelancer_conversations(tenant_id, freelancer_user_id, engagement_id)
  WHERE engagement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fl_conv_job
  ON freelancer_conversations(tenant_id, freelancer_user_id, job_id)
  WHERE job_id IS NOT NULL AND engagement_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_fl_conv_tenant     ON freelancer_conversations(tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_fl_conv_freelancer ON freelancer_conversations(freelancer_user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS freelancer_messages (
  id                VARCHAR(36) PRIMARY KEY,
  conversation_id   VARCHAR(36) NOT NULL REFERENCES freelancer_conversations(id) ON DELETE CASCADE,
  sender_user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  -- Optional attachment (R2 object) — a signed/served link the recipient can open.
  attachment_key    VARCHAR(255),
  attachment_name   VARCHAR(255),
  attachment_type   VARCHAR(120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fl_msg_conversation ON freelancer_messages(conversation_id, created_at);
