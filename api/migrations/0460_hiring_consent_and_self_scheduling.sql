-- 0460 — Candidate lawful basis + retention, segregated EEO capture, and candidate
-- self-scheduling over the existing availability solver.
--
-- ── WHY THESE FOUR CHANGES BELONG IN ONE MIGRATION ──────────────────────────────
-- They are the two halves of the same gap: the hiring domain shipped 23 tables and a
-- Recruiter seat, and had (a) no lawful basis, retention clock or EEO segregation on the
-- most regulated personal data in the product, and (b) no way for the person the data is
-- about to book their own interview, despite `application/calendar/availabilitySolver.ts`
-- being finished and wired to internal meetings only. Shipping the canvas hiring objects
-- without (a) would make the product the controller of unlawfully-held data; shipping
-- them without (b) leaves the largest time sink in the role untouched.
--
-- Cheap NOW and expensive later, deliberately: `party_roles` has no candidate rows in
-- production yet, so this is DDL against empty tables rather than a backfill against a
-- live ATS.
--
-- ── WHY NO NEW `candidates` TABLE ───────────────────────────────────────────────
-- Consent is a fact about a PERSON HOLDING A ROLE, not about an application: a candidate
-- with four applications has one lawful basis, and putting it on `job_applications` would
-- repeat it four times and let the copies disagree — a repeating group, and the exact
-- 3NF violation the data-model rules forbid. `party_roles` already carries exactly one
-- row per (tenant, party_kind, party_ref, role) with a unique index proving it, so it is
-- where a fact about holding the candidate role belongs. The same three columns then
-- carry the EMPLOYEE clock for free, which is the point the HR review made: a rejected
-- candidate has a maximum retention and an employment record a statutory minimum, and
-- they are the same two facts with the rule reversed.

-- ---------------------------------------------------------------------------
-- 1 — Lawful basis and the retention clock, on the role that holds the data
-- ---------------------------------------------------------------------------

ALTER TABLE party_roles
  -- 'consent' | 'legitimate-interest' | 'contract' | 'legal-obligation'.
  -- Deliberately nullable with NO default: an unknown basis must read as unknown, and a
  -- default of 'consent' would assert on every existing row that somebody agreed to
  -- something. A visible gap is the point.
  ADD COLUMN IF NOT EXISTS consent_basis    varchar(32),
  ADD COLUMN IF NOT EXISTS consent_at       timestamp,
  -- 'erase-by'      — the date the record must be GONE by (rejected candidate).
  -- 'retain-until'  — the date before which it must NOT be erased (employment record).
  -- One pair of columns, both clocks, because they are one fact — "when does the law
  -- stop protecting this record" — read from opposite ends.
  ADD COLUMN IF NOT EXISTS retention_basis  varchar(16),
  ADD COLUMN IF NOT EXISTS retention_date   date,
  -- Set by the erasure path so a re-import cannot resurrect somebody who exercised their
  -- right to be forgotten — the same argument `data_suppression_list` already makes for
  -- marketing, applied to the role rather than the address.
  ADD COLUMN IF NOT EXISTS erased_at        timestamp;

-- The sweep that answers "what is overdue for erasure" — a partial index, because the
-- overwhelming majority of rows have no clock and must not be walked to find the few
-- that do.
CREATE INDEX IF NOT EXISTS idx_party_roles_retention
  ON party_roles (tenant_id, retention_date)
  WHERE retention_date IS NOT NULL AND erased_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2 — EEO / diversity self-identification, SEGREGATED
-- ---------------------------------------------------------------------------
--
-- Its own table, and the segregation IS the reason rather than a modelling preference.
-- Self-identified demographic data is collected because statutory reporting requires it
-- (EEO-1, OFCCP, the UK public-sector equality duty) and it is unlawful to use it in an
-- evaluation. Those two rules cannot both be satisfied by a column sitting in
-- `party_roles.attrs` beside the fit score: anything that can read the candidate can
-- read the protected characteristic. A separate table can be granted separately, joined
-- deliberately, aggregated without identifiers, and dropped on its own clock.
--
-- `source` records who typed it. Anything other than 'self' is a compliance defect —
-- observed or inferred demographics are not self-identification, and recording which it
-- was is what makes that auditable instead of assumed.
CREATE TABLE IF NOT EXISTS candidate_demographics (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  candidate_ref varchar(64) NOT NULL,
  -- 'gender' | 'ethnicity' | 'disability' | 'veteran' | 'age-band' | free text for a
  -- jurisdiction that asks something else. A lookup with an order would be wrong here:
  -- the categories are set by whichever regulator the tenant reports to.
  category      varchar(48) NOT NULL,
  response      varchar(160) NOT NULL,
  -- 'self' | 'imported' | 'observed'. See above.
  source        varchar(16) NOT NULL DEFAULT 'self',
  collected_at  timestamp NOT NULL DEFAULT now(),
  created_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidate_demographics UNIQUE (tenant_id, candidate_ref, category)
);

CREATE INDEX IF NOT EXISTS idx_candidate_demographics_candidate
  ON candidate_demographics (tenant_id, candidate_ref);

-- ---------------------------------------------------------------------------
-- 3 — Candidate self-scheduling
-- ---------------------------------------------------------------------------
--
-- The solver, the free/busy merge and the Google Calendar sync all already exist and are
-- consumed by exactly one route — `meetingRoutes.ts`, for tenant-authenticated internal
-- meetings. What was missing is the EXTERNAL half: a link the candidate can open without
-- an account, a set of slots that were actually free when they were offered, and the one
-- they picked.
--
-- No new token table: `share_links` is the tokenised external-access primitive (token
-- hash, scope, expiry, max uses, revocation) and a booking link is one of those with a
-- different scope. Reusing it means revocation, expiry and use-counting are already
-- built and already audited.
ALTER TABLE interviews
  -- The share link that lets the candidate book. Null until the loop is offered.
  ADD COLUMN IF NOT EXISTS booking_share_id  uuid REFERENCES share_links(id) ON DELETE SET NULL,
  -- IANA zone, e.g. 'Europe/Berlin'. Required before a slot is proposed: an offer of 9am
  -- in the recruiter's zone is 3am in the candidate's, and the solver is timezone-correct
  -- only if it is told which timezone to be correct about.
  ADD COLUMN IF NOT EXISTS candidate_timezone varchar(64),
  -- The slots OFFERED, as [{startISO, endISO}]. Stored rather than recomputed because
  -- the offer is a promise: recomputing at booking time can silently drop the slot the
  -- candidate is looking at, and "that time is no longer available" after they clicked is
  -- the single worst moment in a candidate experience. Availability is re-checked at
  -- booking, but against the offer, not instead of it.
  ADD COLUMN IF NOT EXISTS offered_slots      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS booked_at          timestamp,
  -- Set when a booked candidate does not attend. `status` already carries 'no_show'; this
  -- is when it was marked, which is what a no-show RATE is computed from.
  ADD COLUMN IF NOT EXISTS no_show_at         timestamp;

-- A stage names WHO runs it. Without this the self-schedule flow has no panel to clear
-- calendars against, and the only alternative — taking the interviewer list from the
-- request — would let a caller book against an empty panel and skip the availability
-- check entirely. Refs, not a join table: a stage's interviewers are an ordered list read
-- only with the stage, never queried independently, which is the stated bar for the
-- thin-list-to-array departure.
ALTER TABLE interview_kit_stages
  ADD COLUMN IF NOT EXISTS interviewer_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 4 — Source of hire, on the row the funnel is computed from
-- ---------------------------------------------------------------------------
--
-- `job_applications.source` records where an APPLICATION came from. A funnel report needs
-- the source on the PIPELINE ENTRY too, because a candidate sourced from a talent pool
-- and one who applied inbound move through the same stages and convert at wildly
-- different rates — and joining back to the application per stage transition is the
-- fan-out this column exists to avoid. Denormalised deliberately, with a single writer:
-- it is stamped when the entry is created, from the application, and never updated.
ALTER TABLE job_pipeline_entries
  ADD COLUMN IF NOT EXISTS source varchar(48);

CREATE INDEX IF NOT EXISTS idx_job_pipeline_entries_source
  ON job_pipeline_entries (tenant_id, pipeline_ref, source);
