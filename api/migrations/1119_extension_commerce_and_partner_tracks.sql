-- PRD 24 Phase 2 (native billing) + Phase 4 (partner programs).
--
-- ── WHAT THIS DOES NOT ADD, AND WHY ────────────────────────────────────────
-- No `extension_plans`, no `extension_subscriptions`, no
-- `extension_usage_records`, no `extension_payouts`. PRD 24 §5.2 is explicit
-- that a package listing "does not get its own price column, its own order
-- table, or its own payout path", and each of those four tables would have been
-- a second answer to a question this platform already answers:
--
--   plans          → the price list in the package's `catalog_items.body`, the
--                    column the kernel put there for a catalogue entry's payload.
--   subscription   → six columns on `tenant_extension_installs`, all 1:1 with
--                    the install. A table would be reachable only by a join that
--                    can return zero rows for an install that is definitely paid.
--   metered usage  → `ledger_entries` in the new `extension_units` denomination.
--                    A meter needs an append-only history, an idempotency key, a
--                    per-account sum and a period window; that table has all four
--                    and a unique index that makes the idempotency a DATABASE
--                    fact rather than a check somebody remembered to write.
--   payouts        → `ledger_entries` + `connections(capability='payout')`, the
--                    rails every other seller on this platform is paid through.
--
-- So the whole of the money half is eleven columns and two indexes.

-- ── The paid facet of an install ───────────────────────────────────────────
ALTER TABLE tenant_extension_installs
  ADD COLUMN IF NOT EXISTS plan_code           varchar(48),
  ADD COLUMN IF NOT EXISTS subscription_state  varchar(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_ref    varchar(160),
  ADD COLUMN IF NOT EXISTS current_period_end  timestamptz,
  -- The metering WATERMARK. `ledger_entries` has no notion of "already
  -- invoiced", so a period close sums usage at or after this instant, bills it,
  -- and moves the mark forward. Storing a watermark rather than deleting or
  -- flagging the usage rows is what keeps a disputed invoice reconcilable
  -- against the exact events that produced it.
  ADD COLUMN IF NOT EXISTS metered_since       timestamptz,
  -- Cross-domain id into `orders`. Deliberately not a foreign key: an order is
  -- the commerce domain's record of an agreement and must outlive the install.
  ADD COLUMN IF NOT EXISTS last_order_id       integer;

-- The billing sweep's own read: every live paid install, oldest window first.
-- It has no tenant to lead with — closing a period is a platform-wide pass — so
-- `idx_tenant_extension_installs_tenant` cannot serve it. Partial, because paid
-- installs are a small minority of every install ever made.
CREATE INDEX IF NOT EXISTS idx_tenant_extension_installs_billing
  ON tenant_extension_installs (subscription_state, metered_since)
  WHERE subscription_state <> 'none';

-- ── The program columns on the publisher facet ─────────────────────────────
-- One track column rather than two booleans: a publisher is in at most one, and
-- a vendor who is also an agency is two workspaces (§5.1's answer to every "but
-- what if they are also an X"). Featured is a TIMESTAMP because "since when" is
-- the question asked of every placement that was ever disputed, and a boolean
-- cannot answer it.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS publisher_track       varchar(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS publisher_featured_at timestamptz;

-- The directory's ranking read: Featured publishers first. Partial for the same
-- reason as above — nearly every workspace on the platform is not a publisher at
-- all, let alone a featured one.
CREATE INDEX IF NOT EXISTS idx_tenants_publisher_featured
  ON tenants (publisher_featured_at)
  WHERE publisher_featured_at IS NOT NULL;

-- ── The payout destination column, made usable ─────────────────────────────
-- `publisher_payout_connection_id` arrived with 0472, which inherited its type
-- from `developer_orgs.payout_connection_id`. It is documented as "a cross-domain
-- id into `connections`" and `connections.id` is a `serial` — so a `uuid` column
-- could never have held one. Nothing has ever read it (this migration is what
-- gives it its first reader, `extensionEarnings.payoutPublisherBalance`), and any
-- value in it points at a uuid no `connections.id` can equal, so the conversion
-- discards rather than casts. Left as a nullable integer with no foreign key,
-- deliberately: payouts are the commerce domain's, and the column is a reference
-- across a domain boundary exactly as its own comment says.
ALTER TABLE tenants
  ALTER COLUMN publisher_payout_connection_id TYPE integer USING NULL::integer;
