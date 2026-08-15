-- 0469 — Founder operations: the acts a company performs, not the analysis of one.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- The founder vocabulary — 21 canvas kinds covering the company, its rivals, its
-- segments, its money and its paper — is genuinely strong at holding an
-- ANALYSIS. Every gap this migration closes is the same defect class: an act
-- that ends at a card.
--
--  · The canvas could not name a COUNTERPARTY. `company` is us, `competitor` is
--    them, `salesContact` is a person, `customerSegment` is a cohort — nothing
--    was an account you had won, so `invoice.customer` and `bill.vendor` were
--    typed strings and joining a contract to its invoices was a string compare.
--  · It could AUTHOR anything and COLLECT nothing. `PublishedForm`,
--    `FORM_FIELD_TYPES`, `FORM_AUDIENCES` and `FORM_STATUSES` were declared in
--    the contract with a careful argument for each distinction and ZERO
--    consumers anywhere in the repo. The STORE was never the missing half —
--    `question_sets` and `responses` absorbed twelve survey tables and thirteen
--    answer tables. What was missing was the PUBLICATION: no public address, no
--    anonymity switch, no enforceable audience, so a set could be authored and
--    never sent to anybody outside the workspace.
--  · `SIGNATURE_PARTY_STATUSES`, `SIGNATURE_INTENTS` and
--    `isTerminalPartyStatus` were likewise declared and unused —
--    `isTerminalPartyStatus` even documents the three call sites it was written
--    for, and none of the three existed. `contract.sign` was a gated act with
--    nothing behind the gate.
--  · `invoice_line_items` carried `invoice_ref` as a bare varchar pointing at
--    NOTHING: the lines existed and the invoice did not. There was no payables
--    header either, and `finance.expenses` does not cover one — an expense is a
--    reimbursement CLAIM, not a vendor's demand with a due date and an approval.
--  · Nothing owned entity formation, registered agent, jurisdiction
--    registration, IP assignment or trademark. `governance` is SOC 2 and belongs
--    to Security, which is the wrong seat for "have we filed in Delaware".
--  · `grep -i 'co-?founder'` returned no matches anywhere in the frontend: the
--    first artifact a company produces had no home at all.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
-- No counterparty table. `party_roles` already holds exactly one row per
-- (tenant, party kind, party ref, role) with a unique index proving it, so the
-- counterparty EXISTS and the canvas simply could not see it. A second customer
-- store is the collision `finance_soc_controls` exists to record. The canvas
-- `account` kind is a PROJECTION of that row, and `equity_holder` is a new role
-- VALUE in the same column rather than a new table.
--
-- No cap table, no vesting, no issuance event, no e-signature vendor adapter,
-- no invoice-issue handler, no merchant onboarding. Each is its own change and
-- each depends on something here.
--
-- Additive only. Every new table starts empty; the one ALTER adds a column with
-- a default that preserves the exact meaning every existing row already had.

-- ---------------------------------------------------------------------------
-- 1 — Collection: getting an answer from a human outside the workspace
-- ---------------------------------------------------------------------------
--
-- NO `published_forms` AND NO `form_responses`, DELIBERATELY. `question_sets`
-- and `responses` are already the kernel's form and response store — twelve
-- survey tables and thirteen answer tables were consolidated into them. A
-- parallel pair here would be the third response store the canvas contract's own
-- note warns about, and a second answer to "what did this person answer".
--
-- What was missing is PUBLICATION, and publication is columns:
--
--   slug                 the public address. Globally unique and NULLABLE — an
--                        unpublished set has none, and a published one has no
--                        tenant in its URL to disambiguate it with, so the row
--                        reports the tenant rather than the caller asserting it.
--   anonymous            whether a response records WHO answered. A boolean and
--                        not an audience value: an anonymous pulse must not
--                        record the responder even though they are signed in,
--                        while a policy acknowledgement is worthless unless it
--                        does. Conflating them is how an "anonymous" survey
--                        comes to carry a user id.
--   audience_kind        the ENFORCEABLE discriminator, beside the existing
--                        `audience` jsonb which holds what it is parameterised
--                        by. Neither restates the other.
--   confirmation_message what to say afterwards. "Thanks" is rarely the useful
--                        thing — an applicant wants to know what happens next.
--   object_id            the canvas `form` object this set projects.

ALTER TABLE question_sets
  ADD COLUMN IF NOT EXISTS slug                 varchar(64),
  ADD COLUMN IF NOT EXISTS anonymous            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audience_kind        varchar(24) NOT NULL DEFAULT 'anyoneWithLink',
  ADD COLUMN IF NOT EXISTS confirmation_message text,
  ADD COLUMN IF NOT EXISTS object_id            uuid REFERENCES objects(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_question_sets_slug ON question_sets (slug);

-- `responses` is one row per ANSWER, which is the right grain and left one
-- question unanswerable: "how many people responded". Counting distinct
-- respondents works only while there IS a respondent, and on an anonymous form
-- there deliberately is not. A per-submission id closes that without identifying
-- anybody — it groups one person's answers to each other and to nothing else.
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS submission_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_id  integer;

CREATE INDEX IF NOT EXISTS idx_responses_submission ON responses (question_set_id, submission_id);

-- The one genuinely new collection table: a per-recipient CREDENTIAL. Without
-- it `audience_kind = 'namedRecipients'` is decoration — a form that says "named
-- recipients only" and whose route lets anyone holding the slug answer is a lie
-- told by a column, the same defect the register logs against the data room's
-- unenforced nda_required.
CREATE TABLE IF NOT EXISTS form_recipients (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  question_set_id uuid NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  email           varchar(320) NOT NULL,
  name            varchar(200),
  -- The token IS the credential, so only its hash is stored and the entity
  -- layer's redaction removes the column from every generic projection.
  token_hash      varchar(64) NOT NULL,
  invited_at      timestamp NOT NULL DEFAULT now(),
  responded_at    timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_recipients_email ON form_recipients (question_set_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_recipients_token ON form_recipients (token_hash);

-- ---------------------------------------------------------------------------
-- 2 — Signature: what turns a draft into a record
-- ---------------------------------------------------------------------------
--
-- `intent` keeps 'signed' distinct from 'acknowledged'. Acknowledging a handbook
-- and signing an offer are different acts with different evidentiary weight, and
-- a product that records both as "signed" cannot later tell an auditor which one
-- happened. Same table, same trail, different word.
--
-- CHECKED FOR A COLLISION AND THERE IS NONE. `delivery.sign_offs` is the nearest
-- existing shape and it is a different fact: a workspace MEMBER approving version
-- N of an internal subject, addressed by `approver_ref`, with no counterparty, no
-- credential and no document. This is a person OUTSIDE the workspace agreeing to
-- stated terms, reached by a token, with the terms held verbatim as evidence.
-- Folding one into the other would make "an engineer approved the release" and
-- "the customer signed the MSA" the same row.

CREATE TABLE IF NOT EXISTS signature_requests (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE SET NULL,
  subject           varchar(200) NOT NULL,
  intent            varchar(16) NOT NULL DEFAULT 'sign',
  document_title    varchar(200) NOT NULL,
  -- What the signer actually saw, held verbatim rather than resolved from a live
  -- document at signing time: the evidence an auditor needs is what THIS person
  -- saw on THAT day, and a reference to a document somebody edited afterwards is
  -- not that.
  document_body     text NOT NULL,
  document_ref      varchar(64),
  status            varchar(16) NOT NULL DEFAULT 'draft',
  sent_at           timestamp,
  completed_at      timestamp,
  expires_at        timestamp,
  -- 0 disables reminders: a standing invitation that must not chase.
  remind_after_days integer NOT NULL DEFAULT 3,
  last_reminded_at  timestamp,
  created_by        varchar(64),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signature_requests_tenant ON signature_requests (tenant_id, status, updated_at);
-- The reminder sweep's own access path: everything sent and not yet chased.
CREATE INDEX IF NOT EXISTS idx_signature_requests_remind ON signature_requests (status, last_reminded_at);

CREATE TABLE IF NOT EXISTS signature_parties (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  request_id     integer NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  party_ref      varchar(64),
  name           varchar(200) NOT NULL,
  email          varchar(320) NOT NULL,
  -- Signing ORDER. Countersignature is a real requirement — a customer signs,
  -- then we do — and it is a position, not a second table.
  position       integer NOT NULL DEFAULT 0,
  status         varchar(16) NOT NULL DEFAULT 'pending',
  token_hash     varchar(64) NOT NULL,
  viewed_at      timestamp,
  decided_at     timestamp,
  -- What the signer TYPED. The act itself, kept distinct from `name`, which is
  -- what we addressed them as.
  signed_name    varchar(200),
  decline_reason text,
  -- What was true at the moment of the act: the instant, the user agent, a hash
  -- of the address. Never the address itself — a signature record has to be
  -- defensible without becoming a copy of somebody's browsing history.
  evidence       jsonb,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signature_parties_token ON signature_parties (token_hash);
CREATE INDEX IF NOT EXISTS idx_signature_parties_request ON signature_parties (request_id, position);

-- ---------------------------------------------------------------------------
-- 3 — Receivable and payable: the two headers the LINES were pointing at
-- ---------------------------------------------------------------------------
--
-- WHY TWO HEADERS AND NOT ONE WITH A `direction`. Same shape, different
-- invariants. An invoice is issued, aged and chased. A bill is APPROVED,
-- scheduled and disputed — and `approved_by` is the one column here that can
-- cause real financial harm if something fills it in on the requester's behalf.
-- One table would put "who authorised this payment" and "how overdue is this
-- receipt" in the same row and leave the approval column no natural home.
--
-- WHY THE LINES STAY ONE TABLE. The same argument the other way: a billed line
-- has no invariant that differs by direction, so a `bill_line_items` table would
-- be the per-feature copy of an existing shape §0 forbids, and the two copies
-- would drift the first time somebody added a discount column to one.
--
-- NO STORED ageing and NO STORED line total. Ageing is now() - due_at and a
-- stored one is wrong every day after it is written; a stored total is the
-- number that ends up disagreeing with the rows printed directly beneath it.

CREATE TABLE IF NOT EXISTS invoices (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  object_id     uuid REFERENCES objects(id) ON DELETE SET NULL,
  reference     varchar(64) NOT NULL,
  -- party_roles.party_ref for the customer — the counterparty binding.
  customer_ref  varchar(64),
  -- The name as it must appear on the document. Beside the ref rather than
  -- joined at render: an invoice is a legal record of what was SENT, and the
  -- name on it must not change because somebody later renamed the account.
  customer_name varchar(200) NOT NULL,
  currency      varchar(8) NOT NULL DEFAULT 'USD',
  status        varchar(16) NOT NULL DEFAULT 'draft',
  issued_at     timestamp,
  due_at        timestamp,
  amount        numeric(16,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(16,2),
  -- Part payment is the normal case, so this is not a boolean.
  paid_amount   numeric(16,2) NOT NULL DEFAULT 0,
  paid_at       timestamp,
  notes         text,
  created_by    varchar(64),
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_reference ON invoices (tenant_id, reference);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (tenant_id, customer_ref, status);

CREATE TABLE IF NOT EXISTS bills (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  object_id      uuid REFERENCES objects(id) ON DELETE SET NULL,
  -- The VENDOR's reference, not ours — which is why it is unique per vendor and
  -- not per tenant: two suppliers both numbering from 1001 is normal, and one of
  -- them re-sending 1001 is a duplicate that must be refused.
  reference      varchar(64) NOT NULL,
  vendor_ref     varchar(64),
  vendor_name    varchar(200) NOT NULL,
  currency       varchar(8) NOT NULL DEFAULT 'USD',
  status         varchar(16) NOT NULL DEFAULT 'received',
  received_at    timestamp NOT NULL DEFAULT now(),
  due_at         timestamp,
  amount         numeric(16,2) NOT NULL DEFAULT 0,
  tax_amount     numeric(16,2),
  paid_amount    numeric(16,2) NOT NULL DEFAULT 0,
  category       varchar(96),
  approved_by    varchar(64),
  approved_at    timestamp,
  scheduled_for  timestamp,
  paid_at        timestamp,
  disputed_at    timestamp,
  dispute_reason text,
  recurring      varchar(16) NOT NULL DEFAULT 'none',
  notes          text,
  created_by     varchar(64),
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_reference ON bills (tenant_id, vendor_ref, reference);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_bills_schedule ON bills (tenant_id, scheduled_for);

-- The discriminator, defaulted so every existing row keeps meaning exactly what
-- it already meant.
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS document_kind varchar(16) NOT NULL DEFAULT 'invoice';

DROP INDEX IF EXISTS idx_invoice_line_items_invoice;
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
  ON invoice_line_items (tenant_id, document_kind, invoice_ref, position);

-- ---------------------------------------------------------------------------
-- 4 — Legal: the seventeenth seat
-- ---------------------------------------------------------------------------
--
-- `governance` is SOC 2 and belongs to Security — the compliance posture of a
-- company that already EXISTS. Nothing owned the acts that make it exist and
-- keep it existing. Filing those under governance would make that seat mean two
-- things, which is the bounded-context violation §3 exists to refuse.

CREATE TABLE IF NOT EXISTS legal_entities (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  object_id           uuid REFERENCES objects(id) ON DELETE SET NULL,
  legal_name          varchar(255) NOT NULL,
  entity_type         varchar(32) NOT NULL,
  -- Where it is INCORPORATED, frequently not where it operates — Delaware being
  -- the canonical case, and the distinction that makes legal_registrations
  -- necessary rather than redundant.
  jurisdiction        varchar(96) NOT NULL,
  registration_number varchar(96),
  tax_id              varchar(64),
  formed_at           date,
  registered_agent    varchar(255),
  registered_address  text,
  renews_at           date,
  status              varchar(24) NOT NULL DEFAULT 'active',
  is_parent           boolean NOT NULL DEFAULT false,
  parent_id           integer,
  notes               text,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entities_name ON legal_entities (tenant_id, legal_name, jurisdiction);
CREATE INDEX IF NOT EXISTS idx_legal_entities_renewal ON legal_entities (tenant_id, renews_at);

CREATE TABLE IF NOT EXISTS legal_registrations (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  entity_id     integer REFERENCES legal_entities(id) ON DELETE CASCADE,
  jurisdiction  varchar(96) NOT NULL,
  kind          varchar(32) NOT NULL,
  reference     varchar(96),
  registered_at date,
  renews_at     date,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  owner_ref     varchar(64),
  notes         text,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_registrations ON legal_registrations (tenant_id, entity_id, jurisdiction, kind);
CREATE INDEX IF NOT EXISTS idx_legal_registrations_renewal ON legal_registrations (tenant_id, renews_at);

-- Trademarks, patents, designs, copyrights and brand domains are ONE shape —
-- "a right, in a jurisdiction, in a class, with a filing date and a renewal
-- date" — so six tables would be six copies of one renewal calendar.
--
-- `assigned_from` is the founder-IP column and the reason this belongs to the
-- first ninety days: work a founder did before incorporation belongs to the
-- founder until it is assigned, and a company that cannot say which of its IP
-- has been assigned has a diligence problem it discovers during a raise.
CREATE TABLE IF NOT EXISTS intellectual_property (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  object_id           uuid REFERENCES objects(id) ON DELETE SET NULL,
  entity_id           integer REFERENCES legal_entities(id) ON DELETE SET NULL,
  kind                varchar(24) NOT NULL,
  title               varchar(255) NOT NULL,
  jurisdiction        varchar(96),
  classification      varchar(96),
  registration_number varchar(96),
  filed_at            date,
  granted_at          date,
  renews_at           date,
  status              varchar(16) NOT NULL DEFAULT 'idea',
  assigned_from       varchar(200),
  assigned_at         date,
  owner_ref           varchar(64),
  notes               text,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intellectual_property_kind ON intellectual_property (tenant_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_intellectual_property_renewal ON intellectual_property (tenant_id, renews_at);

CREATE TABLE IF NOT EXISTS legal_matters (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE SET NULL,
  entity_id         integer REFERENCES legal_entities(id) ON DELETE SET NULL,
  title             varchar(255) NOT NULL,
  kind              varchar(24) NOT NULL DEFAULT 'advice',
  counterparty_ref  varchar(64),
  counterparty_name varchar(200),
  counsel           varchar(200),
  owner_ref         varchar(64),
  status            varchar(24) NOT NULL DEFAULT 'open',
  exposure          varchar(16),
  -- Two numbers because they answer different questions; a single "cost" column
  -- ends up meaning whichever the last writer intended.
  exposure_amount   numeric(16,2),
  spend_to_date     numeric(16,2),
  currency          varchar(8) NOT NULL DEFAULT 'USD',
  opened_at         date,
  next_action_at    date,
  closed_at         date,
  -- Not activity_log: a matter's chronology is EDITABLE — counsel corrects a
  -- date after the fact — and an append-only audit stream must never allow that.
  timeline          jsonb,
  notes             text,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matters_status ON legal_matters (tenant_id, status, next_action_at);

-- ---------------------------------------------------------------------------
-- 5 — Co-founder matching
-- ---------------------------------------------------------------------------
--
-- A co-founder is not a hire: no requisition, no offer, no salary, no manager.
-- Modelling one as a `candidate` would put a peer into a funnel that ends in an
-- employment relationship. What two co-founders produce is FORMATION paperwork,
-- which is section 4 — so the matching sits beside what it leads to.
--
-- Cross-tenant by construction: the entire value is meeting somebody who is NOT
-- already in your workspace. `visibility` is the access predicate that makes the
-- discovery read legitimate, the same argument catalog_items makes for a public
-- listing.

CREATE TABLE IF NOT EXISTS cofounder_profiles (
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL,
  user_id            varchar(36) NOT NULL,
  headline           varchar(200) NOT NULL,
  bio                text,
  strength           varchar(24) NOT NULL,
  -- Stored, not inferred as the complement of `strength`: "technical founder
  -- seeking technical co-founder" is a real and common search, and a complement
  -- rule would make it unrepresentable.
  seeking            varchar(24) NOT NULL,
  brings             jsonb,
  needs              jsonb,
  -- The single largest cause of a co-founder split, and the cheapest to state up
  -- front.
  commitment         varchar(24) NOT NULL DEFAULT 'full-time',
  -- One honest number rather than a range: a range is two columns pretending to
  -- be a negotiation, and what makes a mismatch visible before either party has
  -- spent six months on it is a number that can disagree.
  equity_expectation numeric(5,2),
  location           varchar(120),
  remote_ok          boolean NOT NULL DEFAULT true,
  sectors            jsonb,
  stage              varchar(24),
  status             varchar(16) NOT NULL DEFAULT 'open',
  visibility         varchar(16) NOT NULL DEFAULT 'private',
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cofounder_profiles_user ON cofounder_profiles (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cofounder_profiles_discovery ON cofounder_profiles (visibility, status, updated_at);

-- An introduction, not a "match": the scorer RANKS, a human ASKS, and the other
-- human answers. Manufacturing mutual matches out of a similarity score would
-- assert an agreement neither party gave.
CREATE TABLE IF NOT EXISTS cofounder_introductions (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  from_profile_id  integer NOT NULL REFERENCES cofounder_profiles(id) ON DELETE CASCADE,
  to_profile_id    integer NOT NULL REFERENCES cofounder_profiles(id) ON DELETE CASCADE,
  message          text,
  -- The score at the moment of asking, so a later ranking change cannot rewrite
  -- why an introduction was made.
  score_at_request integer,
  status           varchar(16) NOT NULL DEFAULT 'requested',
  requested_at     timestamp NOT NULL DEFAULT now(),
  responded_at     timestamp,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cofounder_introductions ON cofounder_introductions (from_profile_id, to_profile_id);
CREATE INDEX IF NOT EXISTS idx_cofounder_introductions_to ON cofounder_introductions (to_profile_id, status);
