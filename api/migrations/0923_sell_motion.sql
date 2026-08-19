-- The SELL MOTION — the commercial half of "idea → real".
--
-- Nine gaps were reported from a seller's-eye review of the canvas. Eight of them are
-- CANVAS objects (`sellMotion.ts` declares the vocabulary; a canvas object is a jsonb row
-- in `creation_session_objects`, so a new kind is not a new table). This migration is the
-- three places the canvas alone could NOT reach:
--
--   1. a priced deal and a live board must be shareable with somebody who has NO ACCOUNT,
--   2. what that person DID with it must be recorded,
--   3. a pipeline card must be able to carry MONEY.
--
-- ── (1) WHY `share_links` GAINS TWO COLUMNS AND NOT A `prospect_shares` TABLE ──────
-- `share_links` (0418) is the kernel's tokenised-access primitive: one expiry policy, one
-- revocation path, hash-only storage. A prospect share IS that — a token that grants
-- access to one object — and a parallel table would be a second revocation path, which is
-- exactly the defect the kernel's own comment records ("three independent API-key
-- revocation paths in this repo alone today; each is a place a revoked token can keep
-- working because somebody fixed only the other two").
--
-- What a prospect share needs that the primitive lacked is not a lifecycle; it is two
-- descriptive facts: what to CALL this link when a seller looks at their list of them, and
-- the presentation settings the buyer-facing page reads (seller branding, whether control
-- may be requested, which cards are on show). Both are generic — a résumé share and a
-- document share want a label too — so they are columns on the primitive rather than a
-- sell-motion table beside it. `metadata` is deliberately jsonb and not a settings table:
-- it is READ ONLY by the page that renders the share and is never joined, aggregated or
-- filtered on, which is the test for when a jsonb column is the right shape.
--
-- ── (2) WHY PROSPECT ENGAGEMENT IS `activity_log` AND NOT AN ANALYTICS TABLE ───────
-- 0295 made `activity_log` the ONE audit store, absorbing `audit_events`. Prospect
-- signals are activity: an actor did something to an object at a time. Writing them
-- anywhere else would give the platform a second event store with its own retention, its
-- own tenant scoping and its own idea of what an actor is — and the CRO coach would then
-- have to read two.
--
-- The one thing that does not fit is the ACTOR. `activity_log.actor_type` carried
-- 'human' | 'hire' | 'cloud_agent' | 'host_agent' | 'system'; a prospect is none of them.
-- A prospect is not a `human` — that value means a tenant member, and classifying an
-- anonymous link-holder as one would put them in every "who is on this workspace" read
-- that filters on it. So 'prospect' is a new VALUE in an existing column, which is the
-- rule this schema already applies everywhere (a new kind is a column value, not a new
-- table). No DDL is required for that — the column is varchar(16) — but the index below
-- is, because "what did prospects do with this object" becomes a real read path and
-- without it, it is a scan of every activity row the platform has ever written.
--
-- ── (3) WHY THE PIPELINE'S MONEY LIVES ON `sales_contacts` ────────────────────────
-- `PipelineCard.valueCents` has been read and rendered by the canvas since the pipeline
-- kanban shipped, and `sales_contacts` had no value column — so nothing could ever WRITE
-- it from the CRM side, and a weighted pipeline or a forecast-to-quota could not be
-- computed at all. `SalesReportView`'s quota meter was therefore fed only by CLOSED
-- revenue, which is to say it could only report the past.
--
-- Value and probability belong on the CONTACT and not on a new `deals` table for the
-- reason 3NF states: a `sales_contacts` row already IS the deal — it carries the stage, the
-- company and the last touch. A `sales_deals` table would be a second row per deal with a
-- foreign key to the first, and the two would immediately disagree about which stage the
-- deal is at.
--
-- `probability_percent` defaults to 0 rather than to a per-stage default, deliberately. A
-- stage-derived probability is a POLICY (see `salesReports.stageProbabilityPercent`), and a
-- policy stored as data on every row is one that cannot be changed without a backfill. 0
-- means "not overridden"; the report reads the policy for those and the stored value for
-- the rows a human has actually judged.

-- ── (1) Prospect-facing shares, on the kernel's own primitive ─────────────────────
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS label    varchar(160),
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN share_links.label IS
  'What to call this link in the list of links a person minted. Never shown to the holder — it is the seller''s own name for "the quote I sent Acme", not a title on the page.';
COMMENT ON COLUMN share_links.metadata IS
  'Presentation settings the receiving page reads: seller branding, whether control may be requested, which objects are on show. Read-only and never joined or filtered on, which is why it is jsonb rather than a settings table.';

-- ── (2) The engagement read: "what did prospects do with this object" ────────────
-- Partial on the verb prefix so it indexes prospect activity only. The alternative —
-- indexing (object_id, occurred_at) for every verb — would be an index over the whole
-- activity log to serve one small class of reads.
CREATE INDEX IF NOT EXISTS idx_activity_log_prospect_object
  ON activity_log (object_id, occurred_at DESC)
  WHERE actor_type = 'prospect';

-- The other direction: "which of my deals has gone quiet", per tenant.
CREATE INDEX IF NOT EXISTS idx_activity_log_prospect_tenant
  ON activity_log (tenant_id, occurred_at DESC)
  WHERE actor_type = 'prospect';

-- ── (3) A pipeline card that counts money ────────────────────────────────────────
ALTER TABLE sales_contacts
  ADD COLUMN IF NOT EXISTS value_cents         integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS probability_percent smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_close_at   timestamptz;

COMMENT ON COLUMN sales_contacts.value_cents IS
  'Deal size in cents. 0 means UNPRICED, not worthless — every read distinguishes the two, because rendering an unpriced deal as $0 is how a real pipeline comes to look empty.';
COMMENT ON COLUMN sales_contacts.probability_percent IS
  '0-100, set by a human who has actually judged this deal. 0 means "not overridden" and the report falls back to the stage policy — a stored per-stage default would be a policy nobody could change without a backfill.';
COMMENT ON COLUMN sales_contacts.expected_close_at IS
  'When this is expected to land. What makes a forecast a PERIOD forecast rather than a total of everything open.';

-- The forecast read: open deals for one owner, newest movement first.
CREATE INDEX IF NOT EXISTS idx_sales_contacts_forecast
  ON sales_contacts (owner_user_id, expected_close_at)
  WHERE stage NOT IN ('won', 'lost');

-- ── The cadence sweep's one read ─────────────────────────────────────────────────
-- The sequence runner asks, on a schedule and across every tenant, "which canvas objects
-- are running cadences". Without this it is a sequential scan of every object on every
-- board the platform holds, once per tick, to find the handful that are cadences — the
-- same argument `idx_question_sets_reminders` (0479) makes for the form reminder sweep.
CREATE INDEX IF NOT EXISTS idx_creation_objects_sequences
  ON creation_session_objects (updated_at)
  WHERE kind = 'sequence';
