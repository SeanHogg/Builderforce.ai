-- 0927 — Ownership: a cap table that survives its second event (FO-D1..FO-D4).
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- `grep cap_table` across the schema returned nothing. The canvas `capTable`
-- was a hand-typed `holders: {holder, instrument, shares, percent}` array whose
-- own hint asked the model to "say so in `summary`" when the percentages did
-- not total 100 — an object that documents its own inability to be right.
--
-- Everything else followed from that one shape:
--
--  · NO ISSUANCE EVENT, so nothing could be APPLIED. A pool top-up, a round, a
--    departure and a buy-back were all re-typing, which is why a cap table
--    could not survive its second event and why "what did we own in March" was
--    a question the data could not answer at all.
--  · NO VESTING. `grep 409a|safe_note|equity_grant` returned nothing; `vesting`
--    appeared only in `career/compensation.ts` and as PROSE inside
--    `offer.equity`. An offer's equity line was a sentence, not a checkable
--    fact, and the cliff — the one date in the whole vocabulary a founder is
--    reliably ambushed by — was unwatchable even though the `due-within`
--    comparator had shipped in 0469.
--  · NO SAFE OR NOTE. The instrument a pre-seed company actually issues could
--    not be represented, so `funding_rounds.instrument = 'safe'` was a label
--    over nothing and a priced round could not be modelled against what came
--    before it.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
-- NO CAP-TABLE TABLE, and that is the point rather than an omission. A cap
-- table is a PROJECTION: `application/finance/equity.ts` folds `equity_events`
-- as of an instant and computes every total on read. Storing one would be the
-- "no stored totals" violation migration 0464 states for `work_estimates.lines`,
-- in the one place where a total that disagrees with its own rows is a legal
-- problem rather than a display bug.
--
-- NO SHARE COUNT ON A GRANT, for the same reason. `equity_grants` carries the
-- TERMS of an award — class, holder, price, schedule — and no quantity. The
-- quantity is the issuance EVENT, so a grant and its ledger can never disagree
-- about how many shares were awarded.
--
-- NO VESTED COLUMN ANYWHERE. Vested-to-date is computed by `vestedQuantity()`
-- in `@builderforce/creation-canvas-contract`, which both the API projection and
-- the canvas card call — one arithmetic, so a company's ownership is never
-- computed two ways.
--
-- NO HOLDER TABLE. `party_roles` already holds exactly one row per (tenant,
-- party kind, party ref, role) with a unique index proving it, and 0469 added
-- `equity_holder` to that role vocabulary (`parties.ts`) for precisely this
-- migration. A holder here is a `party_roles.party_ref`, the SAME ref
-- `canvas_sync_account` joins an account card by. A second holder store is the
-- collision `finance_soc_controls` exists to record.
--
-- Additive only. Every table starts empty.

-- ---------------------------------------------------------------------------
-- 1 — Share classes: what a company has AUTHORISED
-- ---------------------------------------------------------------------------
--
-- `authorized` is the only quantity in this migration that is legitimately a
-- stored number, because it is not a total OF anything: it is a board
-- resolution, a fact about the class rather than a sum over rows. Issued and
-- unallocated are computed against it by the projection.
--
-- WHY `option-pool` IS A CLASS AND NOT A FLAG. A pool has its own authorised
-- count and is diluted by its own grants, and the number a founder is actually
-- asked for — "what is your unallocated pool" — is authorised minus granted
-- WITHIN it. A boolean on common stock cannot express that subtraction.

CREATE TABLE IF NOT EXISTS share_classes (
  id                    serial PRIMARY KEY,
  tenant_id             integer NOT NULL,
  object_id             uuid REFERENCES objects(id) ON DELETE SET NULL,
  -- Which company's stock. Same `company_ref` grain `funding_rounds` uses, so a
  -- round and the classes it prices resolve to one company without a join table.
  company_ref           varchar(64),
  -- The stable reference every grant and event points at. Derived from the name
  -- by `partyRef()`, the same normaliser the counterparty work uses, so two
  -- surfaces writing "Series A" and "series a" cannot produce two classes.
  class_ref             varchar(64) NOT NULL,
  name                  varchar(96) NOT NULL,
  -- 'common' | 'preferred' | 'option-pool'.
  kind                  varchar(16) NOT NULL DEFAULT 'common',
  authorized            numeric(20, 4) NOT NULL DEFAULT 0,
  par_value             numeric(18, 8),
  price_per_share       numeric(18, 8),
  currency              varchar(8) NOT NULL DEFAULT 'USD',
  -- Preference terms. Meaningless on common, which is why they are nullable
  -- rather than defaulted: a 0 preference and NO preference are different
  -- claims, and defaulting would assert the first about every common class.
  liquidation_multiple  numeric(8, 4),
  participating         boolean NOT NULL DEFAULT false,
  -- Lower is more senior. Decides who is paid first in a waterfall.
  seniority             integer NOT NULL DEFAULT 0,
  conversion_ratio      numeric(12, 6) NOT NULL DEFAULT 1,
  votes_per_share       numeric(12, 6) NOT NULL DEFAULT 1,
  -- The round that created this class, when one did. A founder's common has
  -- none, which is why it is nullable.
  funding_round_id      integer REFERENCES funding_rounds(id) ON DELETE SET NULL,
  authorized_at         timestamp,
  notes                 text,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_share_classes_ref ON share_classes (tenant_id, company_ref, class_ref);
CREATE INDEX IF NOT EXISTS idx_share_classes_company ON share_classes (tenant_id, company_ref, seniority);

-- ---------------------------------------------------------------------------
-- 2 — Grants: the TERMS of an award, and no quantity
-- ---------------------------------------------------------------------------
--
-- A grant says WHO gets WHAT KIND of instrument in WHICH class, at what price,
-- on what schedule. What it does not say is how many, because that is the
-- issuance event — and a grant carrying its own count is a stored total the
-- ledger beneath it can contradict the moment anything is cancelled or
-- transferred.
--
-- `holder_name` sits beside `holder_ref` for the same reason
-- `invoices.customer_name` sits beside `customer_ref`: a certificate is a legal
-- record of what was issued to whom, and the name on it must not change because
-- somebody later renamed the party.
--
-- THE VESTING COLUMNS ARE ALL TERMS. `vesting_start_at`, `vesting_months`,
-- `cliff_months`, `vesting_frequency` and `acceleration` are what was AGREED.
-- Vested-to-date is computed from them and never written here.

CREATE TABLE IF NOT EXISTS equity_grants (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE SET NULL,
  company_ref       varchar(64),
  share_class_id    integer NOT NULL REFERENCES share_classes(id) ON DELETE RESTRICT,
  -- `party_roles.party_ref` for the holder, under the `equity_holder` role 0469
  -- added for this. The SAME ref an `account` card joins by.
  holder_ref        varchar(64) NOT NULL,
  holder_name       varchar(200) NOT NULL,
  -- 'common' | 'preferred' | 'option' | 'rsu' | 'warrant'. An option is not a
  -- share until it is exercised, which the projection reports separately.
  instrument        varchar(16) NOT NULL DEFAULT 'common',
  -- Our own certificate / grant number. The natural key a person quotes.
  reference         varchar(64) NOT NULL,
  granted_at        timestamp NOT NULL DEFAULT now(),
  price_per_share   numeric(18, 8),
  -- The 409A fair market value the grant was priced against, when there was one.
  fmv_per_share     numeric(18, 8),
  currency          varchar(8) NOT NULL DEFAULT 'USD',
  vesting_start_at  timestamp,
  vesting_months    integer,
  cliff_months      integer,
  -- 'none' | 'monthly' | 'quarterly' | 'annual'. `none` is fully vested stock.
  vesting_frequency varchar(16) NOT NULL DEFAULT 'none',
  -- 'none' | 'single-trigger' | 'double-trigger'.
  acceleration      varchar(16) NOT NULL DEFAULT 'none',
  -- The round this grant was made under, when it was priced by one.
  funding_round_id  integer REFERENCES funding_rounds(id) ON DELETE SET NULL,
  notes             text,
  created_by        varchar(64),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equity_grants_reference ON equity_grants (tenant_id, company_ref, reference);
CREATE INDEX IF NOT EXISTS idx_equity_grants_holder ON equity_grants (tenant_id, holder_ref);
CREATE INDEX IF NOT EXISTS idx_equity_grants_class ON equity_grants (tenant_id, share_class_id);

-- ---------------------------------------------------------------------------
-- 3 — Convertibles: money that is not yet equity
-- ---------------------------------------------------------------------------
--
-- TWO kinds and not one. A note is DEBT — it accrues interest and matures, and
-- the company must do something on that date. A SAFE is neither. A single
-- "convertible" value would make "what is due when" unanswerable for the one
-- instrument that has an answer.
--
-- `post_money` is decisive rather than cosmetic: on a post-money SAFE the
-- holder's percentage is fixed and the FOUNDERS absorb the dilution from every
-- other SAFE in the stack; on a pre-money one the SAFEs dilute each other.
-- Founders routinely discover the difference at the priced round, which is
-- exactly when it is too late — so it is a stored term and the modeller reads it.
--
-- NO SHARE COUNT HERE EITHER. What a convertible becomes is produced by
-- `convertInstrument()` and recorded as a `conversion` EVENT, so the terms and
-- the shares they produced are one fact in one place. `status` is a lifecycle
-- state of the instrument itself, not an aggregate over rows, which is why it
-- is a column and the share count is not.

CREATE TABLE IF NOT EXISTS convertible_instruments (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  object_id        uuid REFERENCES objects(id) ON DELETE SET NULL,
  company_ref      varchar(64),
  reference        varchar(64) NOT NULL,
  -- 'safe' | 'note'.
  kind             varchar(16) NOT NULL DEFAULT 'safe',
  holder_ref       varchar(64) NOT NULL,
  holder_name      varchar(200) NOT NULL,
  principal        numeric(18, 2) NOT NULL,
  currency         varchar(8) NOT NULL DEFAULT 'USD',
  valuation_cap    numeric(18, 2),
  discount_percent numeric(6, 3),
  post_money       boolean NOT NULL DEFAULT true,
  -- Most-favoured-nation: this holder takes the best terms any later instrument
  -- gets. Carried because it is agreed in conversation and recorded nowhere.
  mfn              boolean NOT NULL DEFAULT false,
  -- Simple annual interest, for a note. Null on a SAFE, which does not accrue.
  interest_rate    numeric(6, 4),
  issued_at        timestamp NOT NULL DEFAULT now(),
  matures_at       timestamp,
  -- 'outstanding' | 'converted' | 'repaid' | 'cancelled'.
  status           varchar(16) NOT NULL DEFAULT 'outstanding',
  converted_at     timestamp,
  -- The round it converted in, and the ledger row that recorded the shares.
  funding_round_id integer REFERENCES funding_rounds(id) ON DELETE SET NULL,
  notes            text,
  created_by       varchar(64),
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_convertible_instruments_reference
  ON convertible_instruments (tenant_id, company_ref, reference);
CREATE INDEX IF NOT EXISTS idx_convertible_instruments_status
  ON convertible_instruments (tenant_id, company_ref, status);
CREATE INDEX IF NOT EXISTS idx_convertible_instruments_maturity
  ON convertible_instruments (tenant_id, matures_at);

-- ---------------------------------------------------------------------------
-- 4 — The ledger: append-only, and the only place a quantity lives
-- ---------------------------------------------------------------------------
--
-- FO-D2. One row per thing that HAPPENED, never an edit to a holding. Seven
-- verbs — issue, transfer, cancel, exercise, repurchase, pool-increase,
-- conversion — each with a declared debit and/or credit leg
-- (`EQUITY_EVENT_LEGS` in the contract), so the fold's arithmetic is data a
-- reviewer can read at once rather than a seven-branch switch.
--
-- APPEND-ONLY IS ENFORCED BY WHO CAN WRITE IT, not by a comment: the entity is
-- registered READ-ONLY through the generic path
-- (`domains/finance/entities.ts`), so a generic PATCH cannot reach it, and
-- every write goes through `application/finance/equity.ts`, which only ever
-- INSERTs. That is the same argument `bills.approved_by` already makes, applied
-- to a table where a silent edit rewrites who owns the company.
--
-- WHY THIS IS NOT `activity_log`, WHICH `check-shape-lint` CORRECTLY ASKS.
-- `activity_log` records what somebody DID — it is a read-only trail beside the
-- state, and deleting it would lose history and nothing else. This table IS the
-- state: the share counts do not exist anywhere else, so a row removed here
-- changes who owns the company. An audit log with a `kind` column cannot carry a
-- debit leg, a credit leg, two share classes and a quantity that a projection
-- folds arithmetically, and putting ownership in the same table as "user viewed
-- a page" would make the most consequential rows on the platform subject to the
-- retention policy of the least. Same word, different noun.
--
-- `effective_at` is separate from `created_at` deliberately. The date something
-- took effect is the one the fold cuts on; the date it was RECORDED is when
-- somebody got round to it, and back-dating a genuine March issuance recorded in
-- May is normal rather than suspicious. Conflating them makes "what did we own
-- in March" answer with what had been typed by March.

CREATE TABLE IF NOT EXISTS equity_events (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  company_ref       varchar(64),
  -- 'issue' | 'transfer' | 'cancel' | 'exercise' | 'repurchase' |
  -- 'pool-increase' | 'conversion'.
  event_kind        varchar(24) NOT NULL,
  -- The class the quantity LEAVES, or the sole class for a single-legged event.
  share_class_id    integer REFERENCES share_classes(id) ON DELETE RESTRICT,
  -- The class it ARRIVES in when that differs: an exercise moves options out of
  -- the pool and common shares in, which is ONE event with two classes rather
  -- than two events that can be half-recorded.
  to_share_class_id integer REFERENCES share_classes(id) ON DELETE RESTRICT,
  grant_id          integer REFERENCES equity_grants(id) ON DELETE RESTRICT,
  instrument_id     integer REFERENCES convertible_instruments(id) ON DELETE RESTRICT,
  funding_round_id  integer REFERENCES funding_rounds(id) ON DELETE SET NULL,
  from_holder_ref   varchar(64),
  to_holder_ref     varchar(64),
  quantity          numeric(20, 4) NOT NULL,
  price_per_share   numeric(18, 8),
  currency          varchar(8) NOT NULL DEFAULT 'USD',
  effective_at      timestamp NOT NULL DEFAULT now(),
  -- Why it happened, in the words of whoever recorded it. A departure, a
  -- board-approved top-up, a secondary sale: the ledger is read by people.
  reason            text,
  recorded_by       varchar(64),
  created_at        timestamp NOT NULL DEFAULT now()
);

-- The fold's own access path: every event for one company, in effect order.
CREATE INDEX IF NOT EXISTS idx_equity_events_company
  ON equity_events (tenant_id, company_ref, effective_at);
CREATE INDEX IF NOT EXISTS idx_equity_events_grant ON equity_events (tenant_id, grant_id);
CREATE INDEX IF NOT EXISTS idx_equity_events_instrument ON equity_events (tenant_id, instrument_id);
