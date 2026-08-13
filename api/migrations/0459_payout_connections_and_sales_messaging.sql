-- 0459 — Payout destinations, and the direct-message hub that sits over them.
--
-- ── payout destinations ─────────────────────────────────────────────────────
-- A payout destination is a `connections` row with capability='payout', and its
-- sealed credential is a `credentials` row. It is NOT its own table.
--
-- It was one, briefly: `payout_connections`, described in its own comment as
-- "the SIXTH per-user connection of the shape mailbox/drive/calendar/board/
-- connector already share". That sentence is the argument against writing it —
-- a shape observed six times is the shape the kernel already owns (PRD 20 §0),
-- `connections.capability` already listed 'payments', and `youtubePublishing`
-- had already proved the pattern in live code. `check-shape-lint` caught it
-- before the deploy that would have created it, so there is no table and no data
-- to move: this migration never ran.
--
-- Two guarantees the dedicated table had are kept, as partial indexes on the
-- kernel table rather than as prose:
--
--   • ONE destination per person per vendor, keyed by USER and deliberately not
--     by tenant — money follows the person, and an associate in two workspaces
--     has one bank account. The kernel's own unique index is tenant-scoped, which
--     is right for a mailbox and wrong for a bank account, so payout adds its own.
--     `tenant_id` survives as the ENCRYPTION scope (credentialCrypto derives
--     per-tenant) and as the audit scope, not as identity.
--   • ONE default. "Two rows both say they are the default" is a data question,
--     so the data answers it.
--
-- ── messaging ───────────────────────────────────────────────────────────────
-- There is NO new table for the message hub. A direct-message thread is a
-- `threads` row with kind='dm' (the kernel already lists 'dm' among its kinds),
-- its participants are `memberships` rows, and its body is `messages` rows —
-- exactly the consolidation PRD 20 §7 describes. What is added here is the one
-- thing the kernel could not supply: an `objects` row of kind 'thread' has to
-- exist for memberships to hang off, so this migration only widens an index so
-- "every thread I am in, newest first" is not a sequential scan.

-- Defensive: an environment that somehow applied an earlier draft of THIS file
-- gets the table removed. It can only ever be empty — the deploy that would have
-- shipped the code writing to it is the one this guard stopped.
DROP TABLE IF EXISTS payout_connections;

-- One destination per person per vendor, across every workspace they belong to.
-- Reconnecting UPDATES that row rather than accumulating dead grants nobody can
-- tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_payout_user_vendor
  ON connections (user_id, vendor) WHERE capability = 'payout';

-- Exactly one default destination per person. A partial unique index costs
-- nothing when nobody is default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_payout_default
  ON connections (user_id) WHERE capability = 'payout' AND config->>'isDefault' = 'true';

-- "Where can this person be paid, and is it healthy" — the listing read.
CREATE INDEX IF NOT EXISTS idx_connections_payout_user
  ON connections (user_id, status) WHERE capability = 'payout';

-- Every DM thread a person is in, newest first, without scanning memberships.
CREATE INDEX IF NOT EXISTS idx_memberships_member_recent
  ON memberships (member_kind, member_ref, state, updated_at DESC);

-- The payout ledger reads "everything paid to this user", which the existing
-- account index serves only when the tenant is known — and a superadmin auditing
-- payouts across workspaces does not know it.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_kind
  ON ledger_entries (account_kind, account_ref, entry_kind, occurred_at DESC);
