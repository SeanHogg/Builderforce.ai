-- FIXED-PRICE WORK — milestones, and the escrow that makes them safe to start.
--
-- The Upwork-parity audit named this P0: only hourly work could be transacted. A
-- freelancer could be hired on a fixed bid, but there was nowhere to say what the
-- deliverables were, no way for the client to prove the money existed before work
-- started, and no release event when a deliverable was accepted. Both sides were
-- asked to trust each other completely or not transact.
--
-- ── WHAT THIS MIGRATION DOES *NOT* ADD, AND WHY ───────────────────────────────────
--
-- 1. NO `job_type` COLUMN. The audit called for `job_postings.job_type (hourly|fixed)`.
--    That column already exists under its real name: `engagement_type`
--    (`fixed_bid|hourly|fte`, migration 0293), read by `gigMarketplaceRoutes`, by the
--    `jobs.create` MCP tool and by the canvas publish path. Adding `job_type` beside it
--    would be one fact in two places — the 3NF violation the data-model rule forbids —
--    and the two would disagree the first time somebody wrote only one. The parity gap
--    was never the column; it was that nothing downstream of it behaved differently.
--
-- 2. NO BALANCE COLUMN, AND NO `escrow_accounts` TABLE. PRD 20 is explicit that the
--    finance domain holds no balances: every payout, commission, credit grant and hold
--    is a `ledger_entries` row separated by `denomination`, and `entry_kind` already
--    includes `'hold'` — which IS escrow. An `escrow_balance_cents` column on a
--    milestone would be a second, unreconcilable answer to "how much is held", and the
--    one that goes wrong silently. So the money MOVES in `ledger_entries` and this
--    table records only the AGREEMENT and its state, exactly as `orders` does.
--
-- ── WHY MILESTONES ARE THEIR OWN TABLE AND NOT A JSONB COLUMN ─────────────────────
-- A milestone is queried, aggregated and gated on independently of its engagement:
-- "what is funded but not released", "what have I submitted that is awaiting approval",
-- "may this freelancer start". Those are the reads a jsonb array cannot serve without
-- scanning, and the funded-before-work gate has to answer per-milestone on every board
-- action. It also has its own lifecycle and its own timestamps, which is the test for a
-- row rather than a field.
--
-- ── THE STATE MACHINE LIVES IN CODE, THE STATES LIVE HERE ────────────────────────
-- `status` is a varchar with a CHECK rather than a pg enum: the platform's convention
-- (see `job_postings.status`, `timecards.status`) and it keeps adding a state to a
-- migration that does not rewrite a type. The legal TRANSITIONS are declared once in
-- `application/marketplace/escrow.ts` and are not restated here — a CHECK can say a
-- value is spellable, never that a move was allowed.

CREATE TABLE IF NOT EXISTS engagement_milestones (
  id                   varchar(36)  PRIMARY KEY,
  tenant_id            integer      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The work this milestone belongs to. BOTH are nullable and at least one is always
  -- set, because a milestone legitimately exists at two different moments:
  --   • proposed against a JOB, by a freelancer bidding a payment schedule, before
  --     anybody is hired (`job_id` set, `engagement_id` null);
  --   • agreed on an ENGAGEMENT, once the bid is accepted (`engagement_id` set).
  -- Accepting a proposal carries the rows forward by stamping `engagement_id`, so the
  -- schedule the client agreed to is the same rows they later fund — not a copy that
  -- can differ from what was bid.
  job_id               varchar(36)  REFERENCES job_postings(id) ON DELETE CASCADE,
  engagement_id        varchar(36)  REFERENCES freelancer_engagements(id) ON DELETE CASCADE,
  proposal_id          varchar(36)  REFERENCES job_proposals(id) ON DELETE SET NULL,

  -- Who gets paid when this releases. Denormalised from the engagement ON PURPOSE and
  -- with a single writer (the accept path): a release must pay the person who was
  -- engaged at the time, and reading it live would repoint historic money if an
  -- engagement were ever reassigned.
  freelancer_user_id   varchar(36)  REFERENCES users(id) ON DELETE SET NULL,

  title                varchar(200) NOT NULL,
  description          text,
  -- Position in the payment schedule. Not a sort on `created_at`: a schedule is
  -- reordered while it is being negotiated, and the order is part of the agreement.
  sequence             integer      NOT NULL DEFAULT 0,

  amount_cents         integer      NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency             varchar(3)   NOT NULL DEFAULT 'USD',

  -- draft      — being negotiated. No money, no work expected.
  -- funded     — the client's money is HELD. This is the state that authorises work.
  -- submitted  — the freelancer says it is done and has asked for acceptance.
  -- approved   — the client accepted it; the release is owed and may be paid.
  -- released   — the money reached the freelancer (or the payout stub recorded it).
  -- cancelled  — abandoned before funding, or funded then refunded to the client.
  -- disputed   — submitted work the client rejected. A terminal-for-now state that
  --              deliberately has no automatic exit: there is no mediation flow yet
  --              (logged as P2 in the parity audit), so it must not silently resolve.
  status               varchar(20)  NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','funded','submitted','approved','released','cancelled','disputed')),

  due_at               timestamp,
  funded_at            timestamp,
  submitted_at         timestamp,
  approved_at          timestamp,
  released_at          timestamp,
  cancelled_at         timestamp,

  -- What the freelancer submitted, and why a client rejected it. Text rather than an
  -- attachment table: the deliverable itself lives wherever the work lives (a PR, a
  -- canvas object, a file), and this is the note that points at it.
  submission_note      text,
  rejection_reason     text,

  created_by_user_id   varchar(36)  REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamp    NOT NULL DEFAULT NOW(),
  updated_at           timestamp    NOT NULL DEFAULT NOW(),

  -- A milestone must belong to something. Without this a row could be orphaned from
  -- both sides and would be invisible to every query in the product.
  CONSTRAINT ck_engagement_milestones_parent CHECK (job_id IS NOT NULL OR engagement_id IS NOT NULL)
);

-- The reads this table actually serves.
CREATE INDEX IF NOT EXISTS idx_engagement_milestones_engagement
  ON engagement_milestones (engagement_id, sequence);
CREATE INDEX IF NOT EXISTS idx_engagement_milestones_job
  ON engagement_milestones (job_id, sequence);
CREATE INDEX IF NOT EXISTS idx_engagement_milestones_tenant_status
  ON engagement_milestones (tenant_id, status);
-- "What am I owed / what have I submitted" — the freelancer's own view, which would
-- otherwise scan the tenant index of every client they have ever worked for.
CREATE INDEX IF NOT EXISTS idx_engagement_milestones_freelancer
  ON engagement_milestones (freelancer_user_id, status);
