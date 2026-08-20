-- 1091 — Make the flagship runway number come from a BOOK instead of from typing.
--
-- `financeRollup` computes burn, revenue, cash and runway from `expenses`,
-- `pay_runs` and `ledger_entries`, and every one of those rows was entered by a
-- person. The ledger PORT (`application/finance/accountingProviders.ts`) declared
-- five providers — QuickBooks, Xero, NetSuite, Plaid, Stripe — and implemented
-- none of them, so the "live, not stale" promise was live over hand-typed data.
-- The adapters landed; this is the storage they need, and it is deliberately small.
--
-- ── WHAT IS *NOT* HERE, AND WHY ─────────────────────────────────────────────────
-- There is no `ledger_transactions` table and no `ledger_connections` table.
--
--  · A synced money movement is a `ledger_entries` row. The kernel ledger is
--    already a signed amount + a denomination + an occurrence date + a UNIQUE
--    `reference`, which is exactly a normalised transaction plus free idempotency:
--    `uq_ledger_entries_reference` on (tenant, denomination, reference) means a
--    re-sync of the same provider id UPDATES rather than duplicating. PRD 20 §0 is
--    explicit that needing a balance earns a denomination and not a table; a
--    `ledger_transactions` table would have been the 60th of the 59 this
--    consolidation absorbed.
--
--  · A connected book is a `connections` row with `capability = 'ledger'`, its
--    credential sealed into the sibling `credentials` row, and its cursor in
--    `sync_states`. That is the same three-table pattern `PayoutAccountService`
--    already uses for payout destinations, for the same reason it gave: a payout
--    destination, a mailbox and a set of books are all "a connected third party
--    with a sealed credential, a status and a reconnect story".
--
-- ── PROVENANCE, WHICH IS THE POINT ──────────────────────────────────────────────
-- A synced row is distinguishable from a typed one by construction rather than by
-- a flag somebody might forget to set: `account_kind = 'external'` is a value NO
-- existing writer produces, and every existing reader of `ledger_entries` filters
-- on 'tenant' | 'user' | 'partner' | 'seller' | 'agent'. So a bank debit can never
-- reach a platform credit balance, and "which of these did a person type?" is one
-- predicate rather than an audit.

-- ── 1. The balances a runway is divided into ────────────────────────────────────
--
-- The one new table, and the one thing `ledger_entries` genuinely cannot hold. The
-- ledger is append-only and models money MOVING; a balance is STATE, and it is not
-- derivable from the movements we synced because the sync never witnessed the
-- opening balance. Without it, the cash half of `finance.runway_months` would be
-- the net flow since somebody connected the account — which for a company that
-- connected last week reads as a runway of days.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  provider      VARCHAR(24) NOT NULL,
  external_id   VARCHAR(200) NOT NULL,
  name          VARCHAR(300) NOT NULL DEFAULT '',
  -- 'bank' | 'credit' | 'other'. Stored rather than inferred because the three net
  -- differently into a cash position: a credit-card balance is money OWED and the
  -- adapters negate it before it arrives here, and 'other' never counts at all.
  account_kind  VARCHAR(16) NOT NULL DEFAULT 'other',
  balance       NUMERIC(20, 2) NOT NULL DEFAULT 0,
  currency      VARCHAR(8) NOT NULL DEFAULT 'USD',
  -- When the PROVIDER says the balance was true, which is not when we stored it.
  as_of_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  synced_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per account per connection, UPDATED in place. This index is what makes
-- the sync idempotent on the provider's own id — re-syncing an account corrects
-- its balance instead of growing a second row the cash total would double-count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_accounts_external
  ON ledger_accounts (tenant_id, connection_id, external_id);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_tenant
  ON ledger_accounts (tenant_id, account_kind);

-- ── 2. Make the synced arm of the rollup cheap ──────────────────────────────────
--
-- `financeRollup` now unions external rows into burn and revenue, and asks a
-- correlated "does this tenant have a synced month here?" per expense row. Both
-- read the same narrow slice of a table that is otherwise dominated by platform
-- credit movements, so the index is PARTIAL: it indexes only the rows the ledger
-- port writes and costs a workspace with no connected book nothing at all.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_external
  ON ledger_entries (tenant_id, occurred_at)
  WHERE account_kind = 'external';
