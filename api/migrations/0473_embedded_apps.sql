-- 0473 — Embedded apps: a board becomes a project, the project IS the app, and
-- the app sells to consumers who never get a second account or a second invoice.
--
-- FOUR CHANGES, ONE MIGRATION, because they are one arc and each is inert
-- without the others: a board that cannot become a project has nowhere to put a
-- landing page, a landing page with no consumer has nobody to sell to, and a
-- consumer with no subscription cannot pay.
--
-- ── creation_sessions.project_id ────────────────────────────────────────────
-- THE ONLY STRUCTURAL CHANGE IN THE WHOLE ARC. The canvas and the delivery side
-- of the platform had no join between them: `creation_sessions` carried no
-- project, and `POST /api/realizations` accepted an idea, a challenge or a
-- project id but never a session — so a person who had just designed something
-- on a board had no action that turned it into a project, and the entire
-- build → publish → deploy → staff pipeline was unreachable from the canvas.
--
-- Nullable, and ON DELETE SET NULL, for the same reason: most boards are never
-- apps, and deleting the project a board became must not delete the board.
ALTER TABLE creation_sessions
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS creation_sessions_project_idx
  ON creation_sessions (project_id);

-- One board per project on the app path. A project may be reached from at most
-- one converted session, so "which board is this app" has exactly one answer;
-- without it a second conversion silently forks the source of truth. Partial, so
-- the unconverted majority (project_id NULL) is unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS creation_sessions_project_unique
  ON creation_sessions (project_id) WHERE project_id IS NOT NULL;

-- ── project_sites.landing_object_id ─────────────────────────────────────────
-- Which `website` canvas card is this site's landing page — the creator's own
-- shop window, in their own brand, on their own address.
--
-- A COLUMN AND NOT A TABLE: a site has exactly one landing page, so a row per
-- site keyed by site would be the same fact stored twice. The canvas object it
-- points at is referenced BY ID rather than by a foreign key into
-- `creation_session_objects`: the canvas is a different bounded context, and a
-- landing page must survive its source card being deleted (it is already
-- published; the bytes are in R2) rather than cascade a live site to nothing.
ALTER TABLE project_sites
  ADD COLUMN IF NOT EXISTS landing_object_id UUID;

-- ── site_collections.raises_tickets ─────────────────────────────────────────
-- Whether a submission to this collection becomes a ticket on the project's
-- board. This is what closes the loop the "project = app" decision opens: the
-- agent workforce maintains the code and, without this, never hears from the
-- people using it — a bug reported by an end user landed in a row no ticket, no
-- manager and no agent would ever read.
--
-- CONFIGURATION ON THE COLLECTION, never a hardcoded collection name: which
-- collection means "feedback" is the creator's decision, and a magic string
-- would make it ours.
ALTER TABLE site_collections
  ADD COLUMN IF NOT EXISTS raises_tickets BOOLEAN NOT NULL DEFAULT FALSE;

-- ── site_subscriptions ──────────────────────────────────────────────────────
-- A recurring relationship between ONE end user and ONE app. The genuinely new
-- fact in this migration, and the one thing the existing commerce rails could
-- not express: `template_licenses` records a standing right with no renewal, and
-- `orders` records a moment. Neither says "this person is paying $4 a month and
-- their period ends on the 12th".
--
-- Money is deliberately NOT here. Settlement runs through the same `orders`,
-- `order_line_items` and `ledger_entries` a one-time sale writes — same
-- reference-keyed idempotency, same rate stamped per sale. A second money path
-- is how a seller's balance and the platform's books stop agreeing.
--
-- `catalog_item_id` is the listing that was bought, so a subscription and a
-- one-time licence describe the same purchase from two angles and can always be
-- joined back to one product.
CREATE TABLE IF NOT EXISTS site_subscriptions (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  -- The SELLER's tenant. Every row here belongs to the workspace that owns the
  -- app, not to the consumer — a consumer has no tenant at all, which is the
  -- entire point of `site_users`.
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_user_id  INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  -- The listing this subscription is against. TEXT to match `catalog_items.id`
  -- (a UUID stored as text there); no FK, because a listing may be withdrawn
  -- while the people already paying for it keep working — the same rule that
  -- makes a licence outlive an unpublish.
  catalog_item_id TEXT,
  -- 'active' | 'past_due' | 'cancelled'. A cancelled row is KEPT: it is the
  -- record that somebody used to pay, and deleting it would silently rewrite
  -- both the creator's history and the platform's.
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  price_cents   INTEGER NOT NULL DEFAULT 0,
  currency      VARCHAR(8) NOT NULL DEFAULT 'USD',
  -- The processor's subscription id. Nullable so a free or comped subscription
  -- is expressible without inventing a fake one.
  provider_ref  VARCHAR(255),
  -- WHICH VERSION THEY HOLD. The same pin as `template_licenses.snapshot_id`,
  -- and load-bearing for the same reason: a buyer is offered an update and is
  -- never moved without accepting, so a seller who ships a bad release cannot
  -- take every existing subscriber with them.
  snapshot_id   UUID,
  current_period_end TIMESTAMP,
  cancelled_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  -- One live subscription per person per app. The database is the arbiter rather
  -- than a check somebody remembered to write: a double-clicked checkout and a
  -- replayed webhook both collide here.
  CONSTRAINT site_subscriptions_site_user_unique UNIQUE (site_id, site_user_id)
);

CREATE INDEX IF NOT EXISTS site_subscriptions_tenant_idx
  ON site_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS site_subscriptions_status_idx
  ON site_subscriptions (site_id, status);
-- The renewal sweep reads by period end across every tenant; without this it is
-- a full scan on a table that only grows.
CREATE INDEX IF NOT EXISTS site_subscriptions_period_idx
  ON site_subscriptions (status, current_period_end);
