-- 0900 — What a subscriber is owed when a HOSTED app goes dark.
--
-- ── THE QUESTION WITHDRAWAL DOES NOT ANSWER ─────────────────────────────────
-- Taking a listing off the catalogue already has settled semantics: the shop
-- window closes and every existing holder keeps what they hold. That falls out
-- of the licence rule and it is the right answer for a `copy`, where the buyer
-- has their own cards on their own board and the seller can never reach them
-- again.
--
-- It is not an answer at all for a `hosted` listing. There, what the buyer holds
-- is ACCESS to an instance THE SELLER RUNS, and nothing about closing a shop
-- window obliges anyone to keep that instance alive. So "the licence outlives
-- the listing" was, for hosted delivery, a promise about somebody else's server
-- that the platform had no mechanism to keep and no written position on. A
-- seller could stop paying a cloud bill and every subscriber would simply find a
-- dead address, with no grace, no export and no remedy.
--
-- This is that position, written BEFORE the first hosted listing is sold —
-- because it is a term of the sale, not a remedy invented after one goes wrong.
--
-- ── FOUR STATES, DERIVED FROM ONE COLUMN ────────────────────────────────────
--   operating   the address answers. Nothing owed beyond the subscription.
--   grace       it stopped answering. Transient outage is the common case, so
--               the seller gets 14 days and billing CONTINUES — a deploy that
--               takes four minutes must not refund a month.
--   readOnly    the window closed. Billing STOPS and each subscriber may export
--               the data they put in.
--   released    still dark 30 days later. Every live subscriber may TAKE the
--               published build as a copy, at no charge.
--
-- `resolveHostedLifecycle` (creation-canvas-contract) derives all four from
-- `unreachable_since` plus the clock. NOTHING here stores the state, for the
-- same reason nothing stores a release's state: a state column is a second copy
-- of a derivable fact, wrong for exactly as long as a sweep is late, and the
-- seller's panel, the subscriber's page and the billing sweep would then be
-- three places that can disagree about whether a month is owed.
--
-- ── WHY A TABLE AND NOT COLUMNS ON `catalog_items` ──────────────────────────
-- Every fact here exists only when `delivery = 'hosted'` — one shape out of the
-- fourteen sellable kinds. Hanging six nullable columns off the catalogue row
-- that policy packs, templates and presets also live in is a partial dependency
-- on a value in a different column, which is exactly what 3NF forbids and
-- exactly how `catalog_items` would acquire its next six.
--
-- ONE ROW PER LISTING: the primary key IS the foreign key, so the "a listing has
-- at most one operating history" rule is the schema rather than a convention.

CREATE TABLE IF NOT EXISTS hosted_listing_lifecycle (
  listing_id         uuid PRIMARY KEY REFERENCES catalog_items(id) ON DELETE CASCADE,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- When the seller closed the shop window. Recorded because nothing else holds
  -- it — `catalog_items.updated_at` also moves for a price change. It does NOT
  -- start the abandonment clock: a withdrawn app that is still serving is a
  -- seller who stopped SELLING, not one who stopped RUNNING it.
  withdrawn_at       timestamp,

  -- THE column the lifecycle derives from: first moment the address was observed
  -- not serving, and still dark since. Cleared the moment a probe succeeds, so a
  -- redeploy does not spend a subscriber's month.
  unreachable_since  timestamp,

  last_probe_at      timestamp,
  last_probe_ok      boolean,
  -- Which address was asked, so a seller reading a breach is not guessing.
  last_probe_url     varchar(1024),

  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

-- The sweep's only query: every listing currently dark, oldest first. Partial,
-- because the healthy majority must never be scanned to find the handful that
-- are not.
CREATE INDEX IF NOT EXISTS idx_hosted_lifecycle_dark
  ON hosted_listing_lifecycle (unreachable_since)
  WHERE unreachable_since IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hosted_lifecycle_tenant
  ON hosted_listing_lifecycle (tenant_id, updated_at DESC);
