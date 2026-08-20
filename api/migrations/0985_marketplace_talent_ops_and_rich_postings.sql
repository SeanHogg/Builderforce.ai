-- ═══════════════════════════════════════════════════════════════════════════════
-- 0985 · Client-side talent ops + richer job postings and proposals
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Two Upwork-parity gaps, in one pass because they touch the same two tables.
--
--
-- 1 · BUDGET IS NOT A RATE, AND THE DIFFERENCE IS THE WHOLE POINT
-- ---------------------------------------------------------------
-- `job_postings` already carried `rate_min_cents` / `rate_max_cents`. Those are a
-- PER-UNIT rate BAND: "$80–$120 an hour". A fixed-price job does not have a rate
-- band, it has a TOTAL: "$6,000 for the thing". The two are different quantities in
-- different units, and the same integer means opposite things in each — 600000 is a
-- reasonable project and an absurd hourly rate.
--
-- So `budget_total_cents` is a NEW column with a unit-bearing name, not a
-- reinterpretation of the existing pair. Which one a reader looks at is decided by
-- `engagement_type`, the column migration 0293 added for exactly that purpose:
-- 'hourly' → read the band, 'fixed_bid' → read the total, 'fte' → read the band as a
-- salary range. Deliberately NO `job_type` column: hourly-vs-fixed is already
-- `engagement_type`, and a second spelling of one fact is how two spellings come to
-- disagree.
--
-- `ck_job_postings_budget_shape` forbids the one combination that is a category
-- error — a whole-job total attached to hourly work. Every existing row has
-- `budget_total_cents IS NULL`, so the constraint is satisfied on arrival and can be
-- added without a rewrite. It is stated as a constraint rather than left to the
-- application because a wrong number here is money, and the application is not the
-- only writer this table will ever have.
--
--
-- 2 · SCREENING QUESTIONS ARE VALIDATED JSONB, NOT ROWS
-- -----------------------------------------------------
-- A `job_screening_questions` table was the obvious shape and is the wrong one:
--
--   * The questions have no life outside their posting. Nothing joins to them,
--     nothing filters on them, nothing references one from elsewhere. They are read
--     with the posting and written with the posting — which is the definition of a
--     column, not a table.
--   * The list is bounded (10) and ordered by authorship. There is nothing to
--     paginate and no growth curve to plan for.
--   * Most importantly, ROWS WOULD BREAK THE ANSWERS. A separate table invites an
--     employer to edit or delete question 3 after ten bids arrived, silently
--     re-keying or orphaning ten people's answers. `job_proposals.screening_answers`
--     therefore carries the question id AND a FROZEN COPY of the prompt as asked, so
--     the record of what this person was asked survives any later edit. Freezing a
--     prompt into the answer is natural in a document and perverse in a normalised
--     table.
--
-- Shape (validated in `api/src/application/marketplace/jobPostings.ts`, which is the
-- only writer, and re-validated on read so a hand-edited row degrades to "no
-- questions" rather than to a crash):
--
--   screening_questions : [{ id, prompt, type: 'text'|'yes_no'|'number', required }]
--   screening_answers   : [{ questionId, prompt, answer }]
--
--
-- 3 · ATTACHMENTS REUSE THE EXISTING BUCKET
-- ------------------------------------------
-- No new blob store. `attachments` names objects already living in the `UPLOADS` R2
-- bucket under `job-attachments/` and `proposal-attachments/`, put and served the
-- same way `freelancer_profiles.avatar_key` and the résumé source file already are.
-- The column holds `[{ id, key, name, mime, size }]` — metadata pointing at bytes,
-- never bytes.
--
--
-- 4 · DISCIPLINE STAYS COARSE; `specialty` DEEPENS IT WITHOUT DDL
-- ----------------------------------------------------------------
-- The 9-value `discipline` vocabulary is the top level and keeps its meaning (the
-- browse filter, the alert sweep and `freelancer_profiles.discipline` all read it).
-- `specialty` is one level beneath it, and its vocabulary is a DATA REGISTRY in
-- `application/marketplace/jobFilters.ts` rather than an enum here — so deepening the
-- category tree is a registry edit, not a migration per level.
--
--
-- 5 · TWO NEW TABLES FOR CLIENT-SIDE TALENT OPS
-- ----------------------------------------------
-- `saved_talent` is the supply-side mirror of `job_proposals.status='saved'`: the
-- client shortlists people the way the seeker shortlists work. `list_name` makes a
-- second shortlist a VALUE rather than a schema change.
--
-- `job_invites` is a state machine, not a notification. The notification is still
-- sent (through `notify()`, like every other marketplace event) but it announces this
-- row rather than being it — and accepting an invite opens the invitee's proposal on
-- the posting, recorded in `proposal_id`, so an invite lands inside the bid flow
-- instead of at a dead end. A live invite is also the GRANT that lets an invited
-- freelancer bid on a `visibility='private'` posting, which is why it is
-- tenant-scoped and why `expires_at` is real.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Richer postings ────────────────────────────────────────────────────────
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS budget_total_cents   integer;
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS experience_level     varchar(20);
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS project_length       varchar(24);
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS specialty            varchar(60);
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS screening_questions  jsonb;
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS attachments          jsonb;

-- A whole-job total on hourly work is a category error, not a preference.
-- Satisfied by every existing row (all NULL), so this adds no rewrite.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_job_postings_budget_shape'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT ck_job_postings_budget_shape
      CHECK (budget_total_cents IS NULL OR engagement_type IS DISTINCT FROM 'hourly');
  END IF;
END $$;

-- Browse filters on (experience level, project length) over the open slice.
CREATE INDEX IF NOT EXISTS idx_job_postings_shape
  ON job_postings (status, experience_level, project_length);

-- ── 2 · Richer proposals ───────────────────────────────────────────────────────
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS screening_answers jsonb;
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS attachments       jsonb;

-- ── 3 · Client shortlist ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_talent (
  id                  varchar(36) PRIMARY KEY,
  tenant_id           integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id       varchar(36) NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  freelancer_user_id  varchar(36) NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  list_name           varchar(80) NOT NULL DEFAULT 'shortlist',
  note                text,
  created_at          timestamp   NOT NULL DEFAULT NOW(),
  updated_at          timestamp   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_talent
  ON saved_talent (tenant_id, owner_user_id, freelancer_user_id, list_name);
CREATE INDEX IF NOT EXISTS idx_saved_talent_owner
  ON saved_talent (tenant_id, owner_user_id, list_name);

-- ── 4 · Job invites ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_invites (
  id                  varchar(36) PRIMARY KEY,
  tenant_id           integer     NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  job_id              varchar(36) NOT NULL REFERENCES job_postings(id)  ON DELETE CASCADE,
  freelancer_user_id  varchar(36) NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  invited_by_user_id  varchar(36)          REFERENCES users(id)         ON DELETE SET NULL,
  message             text,
  status              varchar(20) NOT NULL DEFAULT 'sent',
  expires_at          timestamp,
  viewed_at           timestamp,
  responded_at        timestamp,
  proposal_id         varchar(36)          REFERENCES job_proposals(id) ON DELETE SET NULL,
  created_at          timestamp   NOT NULL DEFAULT NOW(),
  updated_at          timestamp   NOT NULL DEFAULT NOW()
);

-- One live invite per (posting, person): re-inviting someone updates the invite they
-- already have rather than stacking a second one they would have to answer twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_invites_job_user
  ON job_invites (job_id, freelancer_user_id);
CREATE INDEX IF NOT EXISTS idx_job_invites_invitee
  ON job_invites (freelancer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_job_invites_tenant
  ON job_invites (tenant_id, created_at);
