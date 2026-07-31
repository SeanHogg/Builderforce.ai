-- Freelance marketplace, round 3 — turn it into a true two-sided marketplace:
-- open job postings + proposals (bidding), freelancer reviews/reputation, invoices
-- + payment status on approved timecards, and in-app notifications for both sides.

-- 1) Job postings — an employer posts work freelancers can BID on (distinct from a
--    direct engagement/hire). Public postings are world-browsable; private ones only
--    to signed-in members.
CREATE TABLE IF NOT EXISTS job_postings (
  id                 varchar(36) PRIMARY KEY,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         integer REFERENCES projects(id) ON DELETE SET NULL,
  title              varchar(200) NOT NULL,
  description        text,
  discipline         varchar(60),
  skills             text,                 -- JSON string[]
  rate_min_cents     integer,
  rate_max_cents     integer,
  currency           varchar(3)  NOT NULL DEFAULT 'USD',
  status             varchar(20) NOT NULL DEFAULT 'open',      -- open|closed|filled
  visibility         varchar(10) NOT NULL DEFAULT 'public',    -- public|private
  created_by_user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  closed_at          timestamp,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_postings_open ON job_postings(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_job_postings_tenant ON job_postings(tenant_id);

-- 2) Proposals — a freelancer bids on a job. One live proposal per (job, freelancer).
CREATE TABLE IF NOT EXISTS job_proposals (
  id                 varchar(36) PRIMARY KEY,
  job_id             varchar(36) NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  freelancer_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_note         text,
  rate_cents         integer,
  currency           varchar(3)  NOT NULL DEFAULT 'USD',
  status             varchar(20) NOT NULL DEFAULT 'submitted', -- submitted|shortlisted|accepted|declined|withdrawn
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_job_freelancer ON job_proposals(job_id, freelancer_user_id);
CREATE INDEX IF NOT EXISTS idx_proposals_freelancer ON job_proposals(freelancer_user_id);

-- 3) Reviews — an employer rates a freelancer for an engagement (reputation). One per
--    engagement (mirrors agent_feedback for agents).
CREATE TABLE IF NOT EXISTS freelancer_reviews (
  id                 varchar(36) PRIMARY KEY,
  engagement_id      varchar(36) NOT NULL REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  freelancer_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_user_id   varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  rating             integer NOT NULL,     -- 1..5
  comment            text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_engagement ON freelancer_reviews(engagement_id);
CREATE INDEX IF NOT EXISTS idx_reviews_freelancer ON freelancer_reviews(freelancer_user_id);

-- 4) Invoices — generated when a timecard is APPROVED; carries the payment status.
--    Real money movement rides an env-gated payout provider; unconfigured = manual
--    "mark paid". One invoice per timecard.
CREATE TABLE IF NOT EXISTS freelancer_invoices (
  id                 varchar(36) PRIMARY KEY,
  timecard_id        varchar(36) NOT NULL REFERENCES timecards(id) ON DELETE CASCADE,
  engagement_id      varchar(36) NOT NULL REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  freelancer_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents       integer NOT NULL DEFAULT 0,
  currency           varchar(3)  NOT NULL DEFAULT 'USD',
  status             varchar(20) NOT NULL DEFAULT 'pending',   -- pending|paid|void
  external_ref       varchar(200),         -- provider payout/payment id when paid via a provider
  issued_at          timestamp NOT NULL DEFAULT now(),
  paid_at            timestamp,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_timecard ON freelancer_invoices(timecard_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON freelancer_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_freelancer ON freelancer_invoices(freelancer_user_id);

-- 5) In-app notifications for both sides (invite/hire/interview/terminate/proposal/
--    timecard events/review/paid). Recipient = user_id. Append-only; read_at marks read.
CREATE TABLE IF NOT EXISTS freelancer_notifications (
  id          bigserial PRIMARY KEY,
  user_id     varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   integer REFERENCES tenants(id) ON DELETE CASCADE,
  kind        varchar(40) NOT NULL,
  title       varchar(200) NOT NULL,
  body        text,
  ref         varchar(200),            -- engagement/job/timecard/proposal id
  read_at     timestamp,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON freelancer_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON freelancer_notifications(user_id) WHERE read_at IS NULL;
