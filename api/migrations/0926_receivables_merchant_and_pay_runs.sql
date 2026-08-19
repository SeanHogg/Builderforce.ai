-- 0926 — The money coming IN: issuing, being paid, chasing, and what payroll cost.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- 0469 built the receivable HEADER and stopped there, deliberately: the three
-- acts an invoice has needed a header before they could be written, and the
-- merchant onboarding they depend on is its own change. This is that change.
--
--  · FO-C2 — `invoice.issue`, `record-payment` and `chase` were named by
--    `canvasApprovalGate.GATED_ACTIONS` as irreversible or attested, advertised
--    by `founderObjects.ts`, and a grep for the handlers returned the gate and
--    its own test. The gate was working perfectly and there was nothing behind
--    it, exactly as the three bill acts were before 0469. There was no rendered
--    document, no delivery, and `ageing_days` was documented as "computed from
--    `due_at`" by nothing at all.
--  · FO-C4 — a tenant could not take money from their own customers.
--    `PaymentProvider.ts` states there is exactly ONE flow and it is
--    Builderforce's own hosted subscription checkout; `listingCommerce.ts` is the
--    only other paid door and it sells a creation with a platform cut. There was
--    no tenant merchant account at all, while `payoutProviders` could already
--    send money OUT. The finance category was one-directional by construction.
--  · FO-C5 — `invoice.collection` was authored prose under a hint that says
--    "collections work with no record is collections work that gets done twice
--    or not at all". There was no record.
--  · FO-C6's residual — the seven payroll manifests shipped and every one of
--    them needs a tenant to have connected a provider. A workspace with
--    `compensation_structures` and `timesheets` and no Gusto account still could
--    not answer "what did we pay last month", and `finance.burn` was typed
--    rather than read.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
-- NO `merchant_accounts` table. A tenant's connected processor is a connected
-- third party with a sealed credential, a status and a reconnect story, which is
-- the kernel `connections` primitive exactly (PRD 20 §6.2) — the same one
-- `PayoutAccountService` uses for the money going the other way, with
-- `capability = 'merchant'` instead of `'payout'`. A second connection store
-- would be the collision `finops_soc_controls` exists to record.
--
-- NO `invoice_payments` table. A payment is money that MOVED, and money that
-- moved is a `ledger_entries` row — the table whose unique
-- `(tenant, denomination, reference)` index is the reason a replayed webhook
-- collides in the database rather than in a check somebody remembered to write.
-- `entry_kind = 'receipt'` is a new VALUE in an existing column, which is what
-- "denomination is a column" buys: a new money shape is data, not DDL.
--
-- NO `pay_run_line_items` table. `invoice_line_items` already serves two
-- directions through a `document_kind` discriminator, on the argument that a
-- billed line has no invariant that differs by direction. A per-employee pay line
-- is a description, a quantity, a rate and an amount; the argument holds a third
-- time and the discriminator gains a value.
--
-- NO payroll engine. See `connectors/defaults/payroll.ts` for why this platform
-- must never calculate a salary or a tax. Every figure in `pay_runs` is one a
-- provider returned.
--
-- Additive only. Every new table starts empty, and every ALTER adds a column
-- with a default that preserves the exact meaning each existing row already had.

-- ---------------------------------------------------------------------------
-- 1 — Issuing, delivering and being paid (FO-C2, FO-C4)
-- ---------------------------------------------------------------------------
--
-- `issued_by` is separate from `created_by` for the reason `bills.approved_by` is
-- separate from its creator: drafting a document and standing behind the one that
-- left the building are two acts, and only the second is attested.
--
-- `document_token_hash` is the customer's credential for the public document
-- page. They have no Builderforce account, so the token IS the authorisation —
-- and only its HASH is stored, exactly as `form_recipients` and the signature
-- parties already do. The plaintext is returned once, by the issue handler.
--
-- `payment_link_url` is null on a workspace with no connected merchant account.
-- An issued invoice with no link is still a real invoice; it simply has to be
-- paid by bank transfer, which is how most of them are paid anyway.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS issued_by           varchar(64),
  ADD COLUMN IF NOT EXISTS sent_to             varchar(320),
  ADD COLUMN IF NOT EXISTS sent_at             timestamp,
  ADD COLUMN IF NOT EXISTS document_token_hash varchar(64),
  ADD COLUMN IF NOT EXISTS payment_link_url    text,
  ADD COLUMN IF NOT EXISTS payment_session_id  varchar(160),
  -- 'off' | 'notify' | 'auto'. `notify` is the default and it is the
  -- conservative one: the sweep records the rung that is due and tells the
  -- workspace, and nothing reaches a customer unattended. That is the same line
  -- `runTriggerSweep` draws when it refuses to perform a trigger's `thenDo`.
  ADD COLUMN IF NOT EXISTS collection_mode     varchar(16) NOT NULL DEFAULT 'notify';

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_document_token ON invoices (document_token_hash);
CREATE INDEX IF NOT EXISTS idx_invoices_collection ON invoices (tenant_id, collection_mode, status, due_at);

-- ---------------------------------------------------------------------------
-- 2 — The collections ladder, recorded (FO-C5)
-- ---------------------------------------------------------------------------
--
-- `(tenant_id, invoice_ref, step)` UNIQUE is the whole design. A rung can be
-- climbed once per invoice and a second attempt collides in the database, which
-- is what makes the sweep safe to run twice in a day, safe to force-run from the
-- operator control, and safe to retry after a partial failure: it cannot chase
-- the same customer twice for the same rung.
--
-- `outcome = 'pending'` is a rung that is DUE with nothing yet sent — a worklist
-- item rather than a claim. So a workspace that leaves the ladder on `notify`
-- accumulates an honest queue, and turning it up to `auto` later does not skip
-- the rungs recorded while it was quiet.

CREATE TABLE IF NOT EXISTS collection_actions (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  invoice_ref varchar(64) NOT NULL,
  step        integer NOT NULL,
  -- Denormalised so re-tuning the ladder later does not rewrite the history of
  -- what was actually sent.
  step_label  varchar(64) NOT NULL DEFAULT '',
  channel     varchar(16) NOT NULL DEFAULT 'email',
  outcome     varchar(16) NOT NULL DEFAULT 'pending',
  detail      text,
  actor_ref   varchar(64) NOT NULL DEFAULT 'system',
  acted_at    timestamp NOT NULL DEFAULT now(),
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_actions_step ON collection_actions (tenant_id, invoice_ref, step);
CREATE INDEX IF NOT EXISTS idx_collection_actions_invoice ON collection_actions (tenant_id, invoice_ref, step);
CREATE INDEX IF NOT EXISTS idx_collection_actions_outcome ON collection_actions (tenant_id, outcome, acted_at);

-- ---------------------------------------------------------------------------
-- 3 — What payroll actually cost (the residual of FO-C6)
-- ---------------------------------------------------------------------------
--
-- Every column is a figure a provider RETURNED. `gross_amount`,
-- `employer_taxes` and `total_cost` are all three stored rather than the total
-- being derived, because deriving it would silently drop anything a provider
-- bills that is neither — benefits, the provider's own fee — and the total is
-- the one that is burn.
--
-- `paid_at` and not the period is what the burn month keys on: a period that
-- straddles a month boundary would otherwise land its cost in the wrong one.

CREATE TABLE IF NOT EXISTS pay_runs (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  object_id       uuid REFERENCES objects(id) ON DELETE SET NULL,
  -- A connector manifest key, or 'manual' for a run entered by hand from a
  -- bureau's PDF — which is the honest state of most small companies outside
  -- the US, and the reason a connector cannot be the only door.
  source          varchar(48) NOT NULL,
  external_ref    varchar(96) NOT NULL,
  reference       varchar(64) NOT NULL,
  currency        varchar(8) NOT NULL DEFAULT 'USD',
  status          varchar(16) NOT NULL DEFAULT 'processed',
  period_start    timestamp,
  period_end      timestamp,
  paid_at         timestamp,
  gross_amount    numeric(16,2),
  employer_taxes  numeric(16,2),
  total_cost      numeric(16,2) NOT NULL,
  employee_count  integer NOT NULL DEFAULT 0,
  synced_at       timestamp NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_runs_external ON pay_runs (tenant_id, source, external_ref);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_runs_reference ON pay_runs (tenant_id, reference);
CREATE INDEX IF NOT EXISTS idx_pay_runs_paid ON pay_runs (tenant_id, status, paid_at);
