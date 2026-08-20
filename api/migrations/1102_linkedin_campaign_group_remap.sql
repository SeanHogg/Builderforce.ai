-- 1102 — Re-point the LinkedIn ids stored under the OLD level mapping.
--
-- ── WHAT CHANGED ────────────────────────────────────────────────────────────
-- LinkedIn has three levels and so does the ads port, but they were lined up one
-- rung out. The adapter mapped OUR campaign onto a `urn:li:sponsoredCampaign`,
-- which is where LinkedIn keeps the objective, the targeting criteria, the daily
-- budget and the bid — that is an AD SET everywhere else in this port. The level
-- above it (`sponsoredCampaignGroup`), which holds a name, a status and a total
-- budget, is what a campaign is here. The corrected mapping is:
--
--     our campaign  ->  urn:li:sponsoredCampaignGroup
--     our ad set    ->  urn:li:sponsoredCampaign
--     our ad        ->  urn:li:creative
--
-- Under the old reading LinkedIn was the one network where a campaign could not be
-- targeted at all, because the level that carries targeting had nowhere to live.
--
-- ── WHY THE ROWS CANNOT SIMPLY BE MOVED ─────────────────────────────────────
-- An `ad_campaigns` row for LinkedIn holds a sponsoredCampaign id. To become an
-- `ad_sets` row it needs its PARENT group id, and that fact exists only on
-- LinkedIn — it was never stored, and a migration cannot call the API to ask.
--
-- ── WHY THEY ARE NOT DELETED EITHER ─────────────────────────────────────────
-- `ad_insights.campaign_id` cascades. Deleting these rows would destroy every day
-- of LinkedIn spend ever recorded, and the sweep only re-reads a trailing window —
-- so anything older than that window would be gone for good. Spend history is the
-- one thing in this subsystem that cannot be reconstructed from the network later.
--
-- ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
-- It RETIRES the identifier without touching the history. `external_id` is
-- prefixed with a marker that no LinkedIn id can collide with, which means:
--
--   * the insights sweep can never match these rows again (it upserts on
--     (tenant, platform, external_id)), so it inserts fresh campaign-group-level
--     rows on the next run rather than overwriting group figures onto campaign
--     ones — two different grains in one column is the corruption this avoids;
--   * every `ad_insights` row they own keeps pointing at them, so the historical
--     spend stays readable exactly where it was;
--   * the prefix is self-describing in a way a NULL would not be. Anyone reading
--     the table can see what the row is and why it stopped updating.
--
-- The name is stamped too, because a retired row that still reads as a live
-- campaign in a picker is worse than one that says what it is.
--
-- Scoped to `platform = 'linkedin'`: no other network's levels moved.

UPDATE ad_campaigns
   SET external_id = 'retired:li-campaign:' || external_id,
       name        = name || ' (pre-1102 campaign)',
       updated_at  = NOW()
 WHERE platform = 'linkedin'
   AND external_id IS NOT NULL
   AND external_id NOT LIKE 'retired:li-campaign:%';

-- `ad_sets` and `ads` are retired the same way and for the same reason: their rows
-- were written as children of the mis-levelled campaign, so their parent link is
-- wrong even though the ids themselves are real LinkedIn objects. Reached through
-- the campaign, since neither table carries the platform.
UPDATE ad_sets
   SET external_id = 'retired:li-set:' || external_id,
       updated_at  = NOW()
 WHERE external_id IS NOT NULL
   AND external_id NOT LIKE 'retired:li-set:%'
   AND campaign_id IN (SELECT id FROM ad_campaigns WHERE platform = 'linkedin');

UPDATE ads
   SET external_id = 'retired:li-ad:' || external_id,
       updated_at  = NOW()
 WHERE external_id IS NOT NULL
   AND external_id NOT LIKE 'retired:li-ad:%'
   AND ad_set_id IN (
     SELECT s.id FROM ad_sets s
       JOIN ad_campaigns c ON c.id = s.campaign_id
      WHERE c.platform = 'linkedin'
   );
