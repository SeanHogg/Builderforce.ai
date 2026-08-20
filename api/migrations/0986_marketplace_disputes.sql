-- MEDIATION — the exit `disputed` never had.
--
-- 0924 gave fixed-price work an escrow state machine and put `disputed` in the CHECK
-- constraint, then said so out loud in `application/marketplace/escrow.ts`: "`disputed`
-- has no automatic exit ON PURPOSE. There is no mediation flow yet, and a state machine
-- that quietly times a dispute out in somebody's favour is worse than one that stops and
-- says a human is needed." This migration is the human.
--
-- -- WHY NO NEW `escrow_disputes` TABLE -------------------------------------------
-- `gig_disputes` already existed (migration 0425, the commerce consolidation targets):
-- a claim, a reason, an amount, a status of open|mediating|resolved|withdrawn, a
-- resolution and who ruled. That IS a dispute record. It had exactly one thing wrong
-- with it -- its only subject was `gig_project_id` -- and NO writer anywhere in the
-- repo, so adding a second table beside it would have created two answers to "what
-- disputes exist" on the day the first one was finally used.
--
-- So this GENERALISES rather than duplicates. The table is renamed to
-- `marketplace_disputes`, its gig subject becomes one of two, and the escrow milestone
-- becomes the other. A gig marketplace built later disputes through the same rows.
--
-- -- WHY TWO NULLABLE FKs AND NOT A (kind, id) PAIR ------------------------------
-- A `(subject_kind, subject_id)` pair is not a foreign key -- the guard
-- `scripts/check-polymorphic-fk.mjs` exists to say so. Two typed, nullable references
-- with a CHECK that exactly one is set keeps the reference declaratively enforced by
-- the database, which is the property a pair throws away.
--
-- -- WHERE THE MONEY IS, AND IS NOT ----------------------------------------------
-- No balance column, for the same reason 0924 refused one: every hold, payout and
-- refund is a `ledger_entries` row. What is stored here is the AWARD -- how the held
-- amount was split by the ruling -- because that is the mediator's decision and not a
-- derivable fact. The ledger rows a resolution writes reuse the SAME references
-- `escrowLedgerReference()` produces (`escrow:<milestoneId>:release` /
-- `escrow:<milestoneId>:cancel`), so the unique index on
-- (tenant_id, denomination, reference) makes it structurally impossible for one
-- milestone to be paid twice or refunded twice -- whether the money moved through the
-- ordinary escrow path or through a ruling.

-- ---------------------------------------------------------------------------
-- 1 - gig_disputes -> marketplace_disputes
-- ---------------------------------------------------------------------------
--
-- Guarded rather than `IF EXISTS` (Postgres has no `ALTER TABLE IF EXISTS ... RENAME`
-- that also tolerates the target already existing), so re-running is a no-op on a
-- database that has already been migrated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gig_disputes')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_disputes')
  THEN
    ALTER TABLE gig_disputes RENAME TO marketplace_disputes;
  END IF;
END $$;

-- A deployment that never received 0425 gets the table outright.
CREATE TABLE IF NOT EXISTS marketplace_disputes (
  id                    serial       PRIMARY KEY,
  tenant_id             integer      NOT NULL,
  gig_project_id        integer      REFERENCES gig_projects(id) ON DELETE CASCADE,
  raised_by_ref         varchar(64)  NOT NULL,
  reason                varchar(200) NOT NULL,
  detail                text,
  amount_disputed_cents integer,
  status                varchar(16)  NOT NULL DEFAULT 'open',
  resolution            text,
  resolved_by           varchar(64),
  resolved_at           timestamp,
  created_at            timestamp    NOT NULL DEFAULT NOW(),
  updated_at            timestamp    NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2 - The escrow subject, and the ruling
-- ---------------------------------------------------------------------------

ALTER TABLE marketplace_disputes
  -- The milestone under dispute. CASCADE matches `gig_project_id`: a dispute about
  -- work that no longer exists is not a record anybody can act on.
  ADD COLUMN IF NOT EXISTS milestone_id varchar(36) REFERENCES engagement_milestones(id) ON DELETE CASCADE,
  -- WHICH SIDE raised it. `raised_by_ref` says who; this says with what authority, and
  -- it is the column that makes "either party may dispute" checkable -- the escrow
  -- machine's own moves are all one-sided, so a dispute is the first transition where
  -- the acting party is a value rather than a constant.
  ADD COLUMN IF NOT EXISTS raised_by_party varchar(12) NOT NULL DEFAULT 'client',
  -- Where to put the milestone back if the ruling is `restore`. Captured at RAISE
  -- time: by the time a mediator rules, the row says `disputed` and the state it came
  -- from is unrecoverable from the row itself.
  ADD COLUMN IF NOT EXISTS prior_status varchar(20),
  -- release_full | refund_full | split | restore. NULL until the mediator rules.
  ADD COLUMN IF NOT EXISTS outcome varchar(16),
  -- The SPLIT, in cents, as ruled. Both zero for `restore` (no money moved) and each
  -- carries the whole amount for the two full outcomes, so a reader never has to know
  -- which outcome produced which arithmetic.
  ADD COLUMN IF NOT EXISTS award_freelancer_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS award_client_cents integer NOT NULL DEFAULT 0,
  -- Who mediated. Separate from `resolved_by` (which records the acting user id)
  -- because a mediator is ASSIGNED before they rule, and the assignment is the event
  -- that moves the dispute from `open` to `mediating`.
  ADD COLUMN IF NOT EXISTS mediator_user_id varchar(36);

-- Exactly one subject. NOT VALID: the constraint governs every row written from here
-- on, without asserting anything about rows a pre-0425 deployment may hold that this
-- migration cannot see. `gig_disputes` has no writer in the repo, so in practice there
-- are none -- but a migration that can fail on data it never wrote is a migration that
-- blocks a deploy for a reason nobody can act on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_disputes_one_subject'
  ) THEN
    ALTER TABLE marketplace_disputes
      ADD CONSTRAINT marketplace_disputes_one_subject
      CHECK ((gig_project_id IS NOT NULL) <> (milestone_id IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- The vocabulary, as CHECKs -- spellability only. Which TRANSITIONS are legal lives in
-- `application/marketplace/disputes.ts`, beside the escrow machine it extends; a CHECK
-- can say a value exists, never that a move was allowed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_disputes_party') THEN
    ALTER TABLE marketplace_disputes
      ADD CONSTRAINT marketplace_disputes_party
      CHECK (raised_by_party IN ('client', 'freelancer')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_disputes_outcome') THEN
    ALTER TABLE marketplace_disputes
      ADD CONSTRAINT marketplace_disputes_outcome
      CHECK (outcome IS NULL OR outcome IN ('release_full', 'refund_full', 'split', 'restore')) NOT VALID;
  END IF;
END $$;

-- ONE live dispute per milestone. Without this, both parties clicking "dispute" at the
-- same moment opens two mediations over one pot of money, and the second ruling would
-- find the ledger references already taken and silently move nothing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_disputes_open_milestone
  ON marketplace_disputes (milestone_id)
  WHERE milestone_id IS NOT NULL AND status IN ('open', 'mediating');

CREATE INDEX IF NOT EXISTS idx_marketplace_disputes_status
  ON marketplace_disputes (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_disputes_milestone
  ON marketplace_disputes (milestone_id);
-- The worker's own "what am I disputing" read. Cross-tenant by construction (a for-hire
-- account is a member of no workspace), so the index must NOT lead with tenant_id.
CREATE INDEX IF NOT EXISTS idx_marketplace_disputes_raiser
  ON marketplace_disputes (raised_by_ref, status, created_at);

-- The old index name follows the old table name only if 0425 created it; drop the
-- stale one rather than leaving two indexes over the same columns.
DROP INDEX IF EXISTS idx_gig_disputes_status;

-- ---------------------------------------------------------------------------
-- 3 - Each side's position, and what they are standing on
-- ---------------------------------------------------------------------------
--
-- A dispute with a single free-text `detail` field is one side's story. Mediation needs
-- both, filed separately and attributable, plus the mediator's own note -- which is why
-- this is a row per party rather than three more columns.
--
-- ONE STATEMENT PER PARTY, revisable. A dispute is not a thread (the platform already
-- has `threads`/`messages` for that); it is a filing, and the question a mediator asks
-- is "what does each side say", not "what did each side say at 14:03". Every revision
-- is still auditable -- `activity_log` is the platform's ONE audit store and the writer
-- appends there on every change.
CREATE TABLE IF NOT EXISTS dispute_statements (
  id           serial       PRIMARY KEY,
  tenant_id    integer      NOT NULL,
  dispute_id   integer      NOT NULL REFERENCES marketplace_disputes(id) ON DELETE CASCADE,
  -- client | freelancer | mediator.
  party        varchar(12)  NOT NULL,
  author_ref   varchar(64)  NOT NULL,
  position     text         NOT NULL,
  -- `[{ label, url }]`. A value object of the statement: never queried on its own,
  -- never joined to, and meaningless apart from the position it supports -- which is
  -- the test for a jsonb column rather than a child table.
  evidence     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamp    NOT NULL DEFAULT NOW(),
  updated_at   timestamp    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_statements_party
  ON dispute_statements (tenant_id, dispute_id, party);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_statements_party') THEN
    ALTER TABLE dispute_statements
      ADD CONSTRAINT dispute_statements_party
      CHECK (party IN ('client', 'freelancer', 'mediator')) NOT VALID;
  END IF;
END $$;
