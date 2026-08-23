-- 1113 · The campaign's own UTM tag, written once and never re-derived.
--
-- ── THE PROBLEM THIS CLOSES ─────────────────────────────────────────────────────
-- `ad_insights` knows what a network CHARGED. `/api/measurement/breakdown` knows how
-- many sessions turned up. Nothing joins them, and the obvious join does not work:
-- matching GA4's `sessionCampaignName` against `ad_campaigns.name` is string-shaped,
-- so the first rename splits one campaign's history into two campaigns that each look
-- half as effective — and nobody can tell that is what happened.
--
-- The fix is to stop MATCHING and start OWNING: this platform mints the tag itself,
-- once, and puts it on every destination URL it sends to a network.
-- `application/advertising/adUtm.ts` has held that derivation since the ports landed;
-- what it never had was anywhere to put the answer, which is why it had zero callers.
--
-- ── WHY A STORED COLUMN AND NOT A RE-DERIVATION ────────────────────────────────
-- `utmCampaignFor(network, externalId, name)` is deterministic, so re-deriving it
-- looks free. It is not. The digest half is taken from the network plus the network's
-- own campaign id — both immutable — but the readable prefix is `slugify(name)`, and a
-- NAME IS MUTABLE. Re-deriving after somebody renames a campaign in Meta's console
-- yields a different string for the same campaign, which is the precise failure the
-- tag exists to prevent: a tag that CHANGES is worse than no tag, because no tag
-- reports nothing while a changed tag reports a confident wrong number split across
-- two rows.
--
-- So the value is written at first sight of the campaign and the sync's conflict
-- branch deliberately omits this column even though it refreshes everything else from
-- the network. That omission is load-bearing, not an oversight, and is commented as
-- such at `adInsightsSync.importCampaigns`.
--
-- ── NULLABLE, AND WHY THAT IS THE HONEST SHAPE ─────────────────────────────────
-- Every campaign that already exists was created before this column did, and their
-- live destination URLs carry whatever tagging (or none) they were built with. A
-- backfill would mint tags that appear in no URL any click will ever carry, so the
-- column would assert an attribution that does not exist in the wild. NULL means
-- exactly "this campaign predates owned tagging", `utmCampaignOf()` can still read a
-- tag somebody else put on a URL, and the rollup can tell the two apart.
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS utm_campaign varchar(120);

-- Reading "which campaign owns this tag" is the join the measurement side performs,
-- and it is the only query this column has. Partial because a NULL tag is never
-- looked up by tag — an index over the pre-tagging population would be dead weight
-- on every write for rows no read can reach.
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_utm_campaign
  ON ad_campaigns (tenant_id, utm_campaign)
  WHERE utm_campaign IS NOT NULL;
