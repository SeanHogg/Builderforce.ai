-- 0293_gig_marketplace.sql
-- "Publish to Marketplace" — turn any work item into a hireable gig, and make an
-- accepted engagement a REAL scoped project-access grant. One coherent slice:
--
--  A. Two new task_type values: 'product' (a full product/scope brief a Product-
--     Manager agent authors, published for a fixed-bid build) and 'design' (a UI/UX
--     design or design-review gig). Siblings of 'gap'/'security' — ADD VALUE only
--     here (never used as a literal in this file), so it stays safe inside the
--     migration runner's single-file transaction (the rule 0270/0290 followed).
--  B. The ticket -> posting bridge: tasks gain a hireable facet + back-link; a job
--     posting gains source_ticket_id, posting_type (project_bid|design|fte),
--     engagement_type (fixed_bid|hourly|fte) and the free-text requirements /
--     acceptance criteria a proposal is AI-evaluated against.
--  C. AI proposal evaluation: proposal_evaluations (polymorphic subject) stores the
--     LLM-as-judge verdict scoring a bid OR a delivered proposal against the
--     posting's requirements; job_proposals cache last_eval_overall + decline_reason
--     (the courteous "not selected this time" message shown to the candidate).
--  D. Deliverable proposals: after hire, the worker "presents a proposal" tied to the
--     engagement (+ optional ticket) — deliverable_proposals — also AI-evaluable.
--  E. Meetings against a work item: meetings gain ticket_id / job_id / engagement_id
--     so a review/interview meeting is tracked against the exact item ('interview'
--     and 'review' join the free-text meetings.kind vocabulary — no enum change).
--  F. Engagement access scope: an 'active' engagement grants its freelancer scoped
--     access to the engaged project's board (enforced in EngagementAccessService).
--  G. Seed the Product Manager + Designer built-in agents into existing tenants
--     (new tenants get them via provisionBuiltinAgents); builtin_kind keys dispatch.
--
-- Idempotent throughout (ADD VALUE / ADD COLUMN / CREATE TABLE IF NOT EXISTS + a
-- NOT EXISTS guard on the agent seed).

-- A. New task types ----------------------------------------------------------
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'product';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'design';

-- B. Hireable facet on the work item + ticket -> posting bridge --------------
-- tasks has no tenant_id (scoped via its project); the canonical link is
-- job_postings.source_ticket_id — tasks.job_posting_id is a denormalized back-ref
-- kept in sync on publish so the board can badge "Published to Marketplace" without
-- a reverse scan.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hireable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS job_posting_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS idx_tasks_hireable ON tasks(hireable) WHERE hireable;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS source_ticket_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS posting_type    VARCHAR(20) NOT NULL DEFAULT 'project_bid'; -- project_bid|design|fte
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS engagement_type VARCHAR(20);                                -- fixed_bid|hourly|fte
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS requirements    TEXT;                                       -- acceptance criteria a proposal is judged against
CREATE INDEX IF NOT EXISTS idx_job_postings_source_ticket ON job_postings(source_ticket_id);

-- C. Job proposal eval cache + courteous decline -----------------------------
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS last_eval_overall INTEGER; -- 0..100, cached from the latest AI eval for list display
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS decline_reason    TEXT;    -- courteous rejection message shown to the candidate

-- Polymorphic AI evaluation of a proposal (a bid) OR a deliverable proposal,
-- scored by the LLM-as-judge (semanticEval) against the posting's requirements.
CREATE TABLE IF NOT EXISTS proposal_evaluations (
  id                   VARCHAR(36) PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_type         VARCHAR(20) NOT NULL,                 -- job_proposal|deliverable
  subject_id           VARCHAR(36) NOT NULL,
  job_id               VARCHAR(36) REFERENCES job_postings(id) ON DELETE SET NULL,
  faithfulness         REAL,
  answer_relevance     REAL,
  context_relevance    REAL,
  hallucination_rate   REAL,
  overall              REAL NOT NULL DEFAULT 0,               -- 0..1 composite quality score
  method               VARCHAR(10) NOT NULL DEFAULT 'lexical', -- llm|lexical
  summary              TEXT,
  evaluated_by_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposal_evals_subject ON proposal_evaluations(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_proposal_evals_tenant  ON proposal_evaluations(tenant_id, created_at DESC);

-- D. Deliverable proposals (post-hire "present a proposal") -------------------
CREATE TABLE IF NOT EXISTS deliverable_proposals (
  id                VARCHAR(36) PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  engagement_id     VARCHAR(36) NOT NULL REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  ticket_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  job_id            VARCHAR(36) REFERENCES job_postings(id) ON DELETE SET NULL,
  author_user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  body              TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'submitted', -- submitted|accepted|changes_requested|withdrawn
  last_eval_overall INTEGER,                                  -- 0..100 cached from the latest AI eval
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliverable_proposals_engagement ON deliverable_proposals(engagement_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_proposals_tenant     ON deliverable_proposals(tenant_id, created_at DESC);

-- E. Meetings tracked against a work item / posting / engagement -------------
-- 'interview' and 'review' are new values of the free-text meetings.kind (VARCHAR),
-- so no enum change is needed — just three optional back-links.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ticket_id     INTEGER     REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS job_id        VARCHAR(36) REFERENCES job_postings(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS engagement_id VARCHAR(36) REFERENCES freelancer_engagements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_ticket     ON meetings(ticket_id);
CREATE INDEX IF NOT EXISTS idx_meetings_job        ON meetings(job_id);
CREATE INDEX IF NOT EXISTS idx_meetings_engagement ON meetings(engagement_id);

-- F. Engagement access scope -------------------------------------------------
ALTER TABLE freelancer_engagements ADD COLUMN IF NOT EXISTS access_scope VARCHAR(20) NOT NULL DEFAULT 'project'; -- project|board_readonly|tenant

-- G. Seed Product Manager + Designer built-in agents (existing tenants) -------
INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'product-manager-t' || t.id, t.id, 'Product Manager',
       'Product Manager — turns an idea into a shippable, biddable brief',
       'Brainstorms and shapes an idea into a product brief with scope, user stories, acceptance criteria and diagrams, then publishes it to the Marketplace as a project-bid gig so freelancers can estimate, bid, and be hired.',
       '["product-management","discovery","requirements","roadmapping"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'product_manager'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'product_manager');

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'designer-t' || t.id, t.id, 'Designer',
       'Designer — UI/UX design and design review',
       'Shapes UI/UX work — new product design or a review of an existing system''s UX — into a design gig published to the Marketplace, and reviews delivered designs against the brief.',
       '["ui-design","ux","design-review","prototyping"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'designer'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'designer');
