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
-- A payout destination is TENANT-SCOPED, like every other connection. An earlier
-- draft keyed it by user alone — "money follows the person", one bank account
-- across workspaces — and that is genuinely the friendlier product, but it makes
-- every read cross a tenant boundary: the row's credential is sealed with a
-- key derived from ITS tenant, so serving it to another workspace means
-- decrypting that workspace's secret there. `check-tenant-scope` is the rule that
-- says no, and for a credential it is the right rule. A person in two workspaces
-- connects a destination in each.
--
-- Two partial indexes carry what the shared table cannot say on its own:
--
--   • ONE destination per person per vendor, per workspace.
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

-- One destination per person per vendor, within a workspace. Reconnecting
-- UPDATES that row rather than accumulating dead grants nobody can tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_payout_user_vendor
  ON connections (tenant_id, user_id, vendor) WHERE capability = 'payout';

-- Exactly one default destination per person. A partial unique index costs
-- nothing when nobody is default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_payout_default
  ON connections (tenant_id, user_id)
  WHERE capability = 'payout' AND config->>'isDefault' = 'true';

-- "Where can this person be paid, and is it healthy" — the listing read.
CREATE INDEX IF NOT EXISTS idx_connections_payout_user
  ON connections (tenant_id, user_id, status) WHERE capability = 'payout';

-- Every DM thread a person is in, newest first, without scanning memberships.
CREATE INDEX IF NOT EXISTS idx_memberships_member_recent
  ON memberships (member_kind, member_ref, state, updated_at DESC);

-- The payout ledger read is "everything paid to this user IN THIS WORKSPACE",
-- which `idx_ledger_entries_account` already serves — it leads with tenant_id.
-- An earlier draft added a tenant-less index here for a cross-workspace audit;
-- that read no longer exists, and an index nothing queries is only write cost.
