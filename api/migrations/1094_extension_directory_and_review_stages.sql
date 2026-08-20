-- 1094 — The directory half of PRD 24 Phase 3, and the two review stages that
-- were named in §5.5 and never built.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- Phase 1 shipped the third bucket: a publisher registers, verifies a domain,
-- ships a reviewed version, and any tenant installs it under a scope grant.
-- Phase 3 then projected those listings onto `/integrations`. What none of that
-- gave anyone is a DIRECTORY. `listPublicCatalog` returns every listed package
-- ordered by `install_count` — which is a list you can scroll and nothing else.
-- A buyer cannot search it, cannot narrow it, and cannot tell a package that
-- passed review last week from one that passed a year ago. PRD 24 §2.6 says the
-- bottleneck in this ecosystem is discovery and trust, not protocol; a scrollable
-- list is neither.
--
-- Three things land here.
--
-- ═══ 1 · A CATEGORY TAXONOMY THAT IS DATA ═══════════════════════════════════
--
-- `INTEGRATION_CATEGORIES` in `integrations/integrationCatalog.ts` is twelve
-- string literals in a TypeScript array. It is the right shape for that module —
-- it is a TOTAL map over our own port registries, and a thirteenth port category
-- with no home there is meant to be a compile error. It is the wrong shape for a
-- directory of things strangers publish: a vendor in a vertical we have never
-- heard of should not have to wait for a pull request and a deploy to be
-- findable, and "add a category" must not be a code change.
--
-- So the DIRECTORY's taxonomy is a table, seeded with exactly the twelve keys the
-- code already speaks so nothing that works today stops working. A key that also
-- exists in `INTEGRATION_CATEGORIES` renders through the frontend's translated
-- catalogue; a key added later renders with the label stored on its row, in the
-- language it was written in, until somebody translates it. That is the honest
-- trade and it is the same one a package NAME already makes — we do not translate
-- "Acme Payroll" either.
--
-- `position` orders the filter chips. `active = false` retires a category without
-- deleting it, because packages still reference it by key and a deleted row would
-- turn their category into a dangling string.
--
-- ═══ 2 · A SEARCHABLE PROJECTION OF A LISTING ═══════════════════════════════
--
-- `extension_packages.search_text` is the concatenation a person actually
-- searches: the name, the tagline, the description, the category keys, and —
-- the half that matters — the CAPABILITY names out of the published head's spec.
-- Somebody looking for "create an invoice" is looking for an ACTION, and until
-- this column existed there was nowhere that string was stored where a query
-- could reach it: the actions live inside `extension_versions.spec`, a jsonb blob
-- on a different table, one row per version.
--
-- It is a materialized SEARCH PROJECTION, not a stored total. The distinction
-- matters and it is the one `SpecField.derive` draws: a total that its own rows
-- can contradict must never be stored, because the two answers disagree and the
-- stored one wins. A search index cannot contradict anything — it is lossy by
-- construction, it is rebuilt from the same source on every publish, and the
-- worst a stale one does is fail to match. It is written in exactly two places
-- (`createPackage` and `publishVersion`), both of which already hold the values.
--
-- FULL-TEXT, NOT TRIGRAM. `to_tsvector`/`websearch_to_tsquery` are core
-- PostgreSQL; `pg_trgm` is an extension, and `CREATE EXTENSION` in a migration is
-- a deploy that fails on any deployment whose role cannot create it. Full text
-- gives stemming ("invoices" finds "invoice"), which is the behaviour a directory
-- actually needs, and the query layer adds a plain ILIKE branch for the prefix and
-- substring matches a lexeme index cannot serve. One extension avoided, one
-- behaviour lost that was already covered.
--
-- ═══ 3 · REVIEW STAGES, WITH THEIR EVIDENCE ═════════════════════════════════
--
-- `extension_versions.review_findings` is a flat list of `{check, severity,
-- message}`. It was enough for the static stage, whose every check is a statement
-- about the submitted JSON. It is not enough for a stage that goes and DOES
-- something: "the dynamic stage passed" is worthless without which actions were
-- exercised, against what URL, with what status, in how long, and — the entry
-- that keeps the whole stage honest — which ones were NOT invoked and why.
--
-- A review pipeline that reports a pass it cannot evidence is worse than no
-- pipeline, because it converts an unknown into a false assurance. So each stage
-- run is a ROW, carrying its own verdict, its own findings and an evidence array
-- with one entry per thing exercised. `sandbox_tenant_id` records which workspace
-- the dynamic stage actually installed into, so a reader can go and look.
--
-- ── AND THE SANDBOX ITSELF ──────────────────────────────────────────────────
-- The dynamic stage needs a tenant to install into. It is seeded here rather than
-- created on first use so that the row is deterministic, so that a fresh
-- deployment has it before the first submission, and so the id it holds is not a
-- side effect of whoever happened to submit first. The application still creates
-- it if it is absent, because a development database restored from before this
-- migration must degrade to a skipped stage, never to a crash.

-- ═══ 1 · The category taxonomy ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS extension_categories (
  -- The key packages already store in `extension_packages.categories`. It is the
  -- primary key because it IS the identity: a surrogate id would let two rows
  -- claim 'finance' and leave the reader to work out which one a listing meant.
  key         varchar(48)  PRIMARY KEY,
  label       varchar(120) NOT NULL,
  description text,
  -- Chip order in the directory. Ties break on `key` so the order is total.
  position    integer      NOT NULL DEFAULT 100,
  -- Retire, never delete: listings reference the key, and a deleted row turns
  -- their category into a dangling string nobody can filter by or explain.
  active      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extension_categories_active ON extension_categories (active, position);

-- Seeded with the twelve keys `INTEGRATION_CATEGORIES` already speaks, in that
-- order, so every listing that already carries one keeps rendering. `work` and
-- `incident` come from the board/delivery ports rather than the connector
-- vocabulary, and both are legitimate places for a published package to sit.
INSERT INTO extension_categories (key, label, description, position) VALUES
  ('work',          'Work management',    'Boards, backlogs, tickets and the systems delivery already runs in.',        10),
  ('devtools',      'Developer tools',    'Source control, CI, deployment and everything an engineer wires up.',        20),
  ('incident',      'Incident & on-call', 'Paging, status, escalation and the first minutes of an outage.',             30),
  ('communication', 'Communication',      'Chat, email and the channels a team already talks in.',                      40),
  ('crm',           'CRM & sales',        'Contacts, accounts, pipeline and the record of a customer relationship.',    50),
  ('productivity',  'Productivity',       'Documents, notes, calendars and the everyday tools around the work.',        60),
  ('finance',       'Finance',            'Ledgers, invoicing, payments, payouts and the numbers behind them.',         70),
  ('marketing',     'Marketing',          'Campaigns, ads, content and the measurement that grades them.',              80),
  ('support',       'Support',            'Help desks, customer conversations and the queue behind them.',              90),
  ('storage',       'Storage & files',    'Drives, buckets and wherever the documents actually live.',                 100),
  ('data',          'Data & analytics',   'Warehouses, product analytics and the sources an insight is drawn from.',   110),
  ('hiring',        'Hiring',             'Job boards, applicant tracking and the systems a requisition flows through.', 120),
  ('other',         'Other',              'Everything that does not sit cleanly in one of the categories above.',      900)
ON CONFLICT (key) DO NOTHING;

-- ═══ 2 · The search projection ══════════════════════════════════════════════

ALTER TABLE extension_packages ADD COLUMN IF NOT EXISTS search_text text;

-- Backfill what can be known without re-parsing a spec in SQL. The capability
-- names arrive on the next publish, which is the only moment the application
-- holds a parsed manifest — and a listing that is never published again is a
-- listing nobody is searching for.
UPDATE extension_packages
   SET search_text = lower(
         name || ' ' || tagline || ' ' ||
         COALESCE(description, '') || ' ' ||
         COALESCE((SELECT string_agg(c, ' ') FROM jsonb_array_elements_text(categories) AS c), '')
       )
 WHERE search_text IS NULL;

-- The lexeme index the directory's primary match runs on. `to_tsvector` with a
-- LITERAL regconfig is immutable, which is what makes it indexable at all — the
-- one-argument form is not, and would be rejected here.
CREATE INDEX IF NOT EXISTS idx_extension_packages_fts
  ON extension_packages USING gin (to_tsvector('english', COALESCE(search_text, '')));

-- The directory's own read: listed packages, newest-reviewed first within a kind.
CREATE INDEX IF NOT EXISTS idx_extension_packages_directory
  ON extension_packages (listing_state, kind, install_count DESC);

-- ═══ 3 · Review stages ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS extension_review_stages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id     uuid        NOT NULL REFERENCES extension_versions(id) ON DELETE CASCADE,
  -- 'static' | 'dynamic' | 'agentic'. A VALUE, not a table, for the same reason
  -- `extension_packages.kind` is one: adding a stage is a registry entry.
  stage          varchar(24) NOT NULL,
  -- 'pass' | 'warn' | 'fail' | 'skipped'. `skipped` is a first-class outcome and
  -- is the entry that keeps the pipeline honest: a stage that could not reach its
  -- sandbox says so, and is never silently recorded as a pass.
  verdict        varchar(16) NOT NULL,
  -- The same `{check, severity, message}` shape `review_findings` uses, so one
  -- renderer draws a static finding and a dynamic one.
  findings       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- One entry per thing this stage actually exercised: the action or tool, what
  -- happened, and the concrete trace — method, url, status, duration. This is the
  -- column that makes "the dynamic stage passed" a statement somebody can check.
  evidence       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Which workspace the stage installed into, when it installed into one. A
  -- cross-domain id rather than an FK: the sandbox is an ordinary `tenants` row
  -- and deleting it must not delete the record that a review ran against it.
  sandbox_tenant_id integer,
  duration_ms    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per (version, stage): a re-review REPLACES its stage rather than
-- appending, so "what did the dynamic stage say about 1.2.0" has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_extension_review_stage ON extension_review_stages (version_id, stage);
CREATE INDEX IF NOT EXISTS idx_extension_review_stages_verdict ON extension_review_stages (stage, verdict);

-- ═══ 4 · The review sandbox tenant ══════════════════════════════════════════
--
-- ONE platform-wide sandbox, not one per publisher. The workspace this row names
-- is where a CANDIDATE version is installed for the length of one dynamic review
-- and then uninstalled again; nothing accumulates in it, no customer data is ever
-- in it, and a publisher never signs into it. A sandbox per publisher would be a
-- tenant row per vendor for a workspace that is empty between reviews, which is
-- the Neon-cost decision PRD 24 §9.4 asks about pointed at a table that does not
-- need it.
--
-- `plan = 'free'` and the default `status = 'active'` are deliberate: a suspended
-- tenant would make the install path refuse, and a paid plan would put a review
-- fixture on an invoice.

INSERT INTO tenants (name, slug, plan)
VALUES ('Extension Review Sandbox', 'extension-review-sandbox', 'free')
ON CONFLICT (slug) DO NOTHING;
