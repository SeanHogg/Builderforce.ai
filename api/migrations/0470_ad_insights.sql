-- 0470 — Ad insights: the measurement half of paid advertising.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- Migration 0432 created `ad_campaigns`, `ad_sets` and `ads` as PRD 20 growth
-- targets owned by the CMO. Until now they had no application code and no
-- provider behind them, so a paid campaign could be written down and never
-- reached a network, and nothing anywhere held what a campaign COST or
-- RETURNED. The `measure` stage of idea → make → run → measure → market simply
-- had no paid-media input.
--
-- `ad_insights` is that input. One row per campaign per day.
--
-- ── WHY DAILY ROWS, NOT A RUNNING TOTAL ─────────────────────────────────────
-- Every ad network RESTATES history: a conversion attributed three days after
-- the click changes what Tuesday cost per lead, and Meta, Google and TikTok all
-- re-report a trailing window for exactly that reason. A running total cannot
-- absorb a correction — it can only be added to. Daily rows can be updated in
-- place, which is why the sweep re-reads a trailing window rather than only
-- yesterday.
--
-- ── THE UNIQUE INDEX IS THE IDEMPOTENCY KEY ─────────────────────────────────
-- `uq_ad_insights_day (tenant_id, campaign_id, date)` is what makes re-syncing
-- safe. Without it, every sweep over that trailing window would APPEND another
-- copy of the same day, and reported spend would compound on a schedule while
-- nothing was actually being bought — a number that grows on its own is worse
-- than a number that is missing, because it looks like it is working.
--
-- ── WHY `platform` IS DENORMALIZED ──────────────────────────────────────────
-- It is copied from `ad_campaigns.platform`, which 3NF would normally forbid.
-- The justification: every rollup this table exists to serve filters or groups
-- by network, and the alternative is joining `ad_campaigns` on every read for a
-- value that is immutable for a given campaign. There is exactly ONE writer —
-- `advertising/adInsightsSync.ts` — and it copies the parent's value, so the
-- two cannot disagree.

CREATE TABLE IF NOT EXISTS ad_insights (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  campaign_id   integer NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  platform      varchar(32) NOT NULL,
  date          date NOT NULL,
  spend_cents   integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  conversions   integer NOT NULL DEFAULT 0,
  currency      varchar(8) NOT NULL DEFAULT 'USD',
  synced_at     timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_insights_day
  ON ad_insights (tenant_id, campaign_id, date);

-- The read pattern every insights panel uses: one tenant, one date window.
CREATE INDEX IF NOT EXISTS idx_ad_insights_tenant_date
  ON ad_insights (tenant_id, date);

-- `ad_campaigns` gains the two columns a SYNCED campaign needs and an authored
-- one did not: which normalized objective it maps to (`objective` already
-- exists and holds ours), and when the network was last read. Without
-- `last_synced_at` a stale panel is indistinguishable from a campaign that
-- genuinely spent nothing.
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS native_objective varchar(64);
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS last_synced_at timestamp;
