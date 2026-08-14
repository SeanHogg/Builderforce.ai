-- 0462 — Career intent on the "list my services / hire me" listing.
--
-- WHY THESE ARE COLUMNS AND NOT A NEW TABLE
-- ------------------------------------------------------------------------------
-- The platform already models both sides of employment and nobody connected them:
-- `job_postings.posting_type` accepts 'fte', `job_postings.engagement_type` accepts
-- 'fte', and `job_proposals.status` already runs submitted → shortlisted → accepted →
-- declined → withdrawn. A full-time job IS a posting; a job application IS a proposal.
--
-- What was missing was never the pipeline — it was the SUPPLY side declaring which kind
-- of demand it wants. A separate `candidate_profiles` table would have given one person
-- two profiles, two résumés, two reputations and two inboxes for the same working life,
-- and would have broken the register's own rule that a new KIND is a column value rather
-- than a new table.
--
-- So: one listing, one résumé, one reputation, two kinds of demand.
--
--   seeking                  services | employment | both | not_looking
--   target_roles             JSON string[] — what an employment search matches on
--   seniority                the level being sought, not the level last held
--   desired_salary_*_cents   the expectation, so screening does not need a round to find it
--   work_mode                remote | hybrid | onsite — the first filter employers apply
--   notice_period_days       turns "when could you start?" into an answer
--   open_to_relocation       the other question every employment screen asks
--
-- The default is 'services', which preserves the existing behaviour of every row that
-- exists today: a profile written before this migration is a services listing and stays
-- one until its owner says otherwise.

ALTER TABLE freelancer_profiles
  ADD COLUMN IF NOT EXISTS seeking                   VARCHAR(20)  NOT NULL DEFAULT 'services',
  ADD COLUMN IF NOT EXISTS target_roles              TEXT,
  ADD COLUMN IF NOT EXISTS seniority                 VARCHAR(30),
  ADD COLUMN IF NOT EXISTS desired_salary_min_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS desired_salary_max_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS work_mode                 VARCHAR(10),
  ADD COLUMN IF NOT EXISTS notice_period_days        INTEGER,
  ADD COLUMN IF NOT EXISTS open_to_relocation        BOOLEAN      NOT NULL DEFAULT FALSE;

-- The employment feed asks exactly one question of this table — "who is published and
-- open to employment?" — so it gets the one partial index that answers it. Kept partial
-- because the majority of rows are services-only listings that this query never reads.
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_seeking_employment
  ON freelancer_profiles (seeking)
  WHERE published = TRUE AND seeking IN ('employment', 'both');
