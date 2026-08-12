-- 0459 — Payout destinations, and the direct-message hub that sits over them.
--
-- ── payout_connections ──────────────────────────────────────────────────────
-- The SIXTH per-user connection of the shape mailbox/drive/calendar/board/
-- connector already share: a sealed credential, a status, a reconnect story.
-- Keyed by USER rather than tenant+user, because money follows the person: an
-- associate in two workspaces has one bank account, and asking for it twice
-- would store one fact in two rows. `tenant_id` survives as the ENCRYPTION scope
-- (credentialCrypto derives per-tenant) and as the audit scope, not as identity.
--
-- ── messaging ───────────────────────────────────────────────────────────────
-- There is NO new table for the message hub. A direct-message thread is a
-- `threads` row with kind='dm' (the kernel already lists 'dm' among its kinds),
-- its participants are `memberships` rows, and its body is `messages` rows —
-- exactly the consolidation PRD 20 §7 describes. What is added here is the one
-- thing the kernel could not supply: an `objects` row of kind 'thread' has to
-- exist for memberships to hang off, so this migration only widens an index so
-- "every thread I am in, newest first" is not a sequential scan.

CREATE TABLE IF NOT EXISTS payout_connections (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             VARCHAR(64) NOT NULL,
  provider            VARCHAR(24) NOT NULL,
  account_label       VARCHAR(255) NOT NULL DEFAULT '',
  currency            VARCHAR(8),
  country             VARCHAR(8),
  external_account_id VARCHAR(128),
  credential_enc      TEXT NOT NULL,
  credential_iv       VARCHAR(64) NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'connected',
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  last_error          TEXT,
  last_payout_at      TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One destination per person per provider. Reconnecting UPDATES this row rather
-- than accumulating dead grants nobody can tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_connections_user_provider
  ON payout_connections (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_payout_connections_user
  ON payout_connections (user_id, status);

-- "Two rows both say they are the default" is a data question, so the data
-- answers it. A partial unique index costs nothing when nobody is default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_connections_default
  ON payout_connections (user_id) WHERE is_default;

-- Every DM thread a person is in, newest first, without scanning memberships.
CREATE INDEX IF NOT EXISTS idx_memberships_member_recent
  ON memberships (member_kind, member_ref, state, updated_at DESC);

-- The payout ledger reads "everything paid to this user", which the existing
-- account index serves only when the tenant is known — and a superadmin auditing
-- payouts across workspaces does not know it.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_kind
  ON ledger_entries (account_kind, account_ref, entry_kind, occurred_at DESC);
