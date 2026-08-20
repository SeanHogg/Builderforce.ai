-- 0935 — Give a published site's submissions a LINEAGE back to the session that built it.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
-- `creation_outcome_events` measures the PROCESS ("this session produced an
-- artifact in 1.1 minutes"). `metric_facts` measures the OUTCOME ("the tenant
-- got some leads"). They shared no join key at all, and `site_collections` —
-- the table every public submission lands through — carried `site_id`,
-- `tenant_id` and `project_id` and no session or artifact lineage whatsoever.
--
-- So the two halves of "idea → delivered outcome" were measured by two systems
-- that never met. We could say a session made a thing, and separately that leads
-- arrived, and never that THIS thing produced THOSE leads. That join is the
-- entire difference between measuring output and measuring impact.
--
-- ── THE COLUMN ──────────────────────────────────────────────────────────────
-- `origin_session_id` is stamped when the realization layer provisions a
-- collection for a proof's form — the one path where the platform genuinely
-- knows which idea a collection belongs to. A collection somebody created by
-- hand on a site keeps NULL, which is the honest reading: nobody knows, and
-- guessing the site's most recent session would attribute a stranger's leads to
-- whichever board happened to be open.
--
-- ON DELETE SET NULL, deliberately and for the same reason 0484 gives: deleting
-- a board must never delete the record of submissions that are still arriving at
-- a URL somebody has already been sent.
--
-- Attribution of the FACTS themselves rides `metric_facts.object_id`, which the
-- growth rollup now stamps with the published site's registry object. This
-- column is the other end of the same thread — the one that says which session
-- put the site there in the first place.

ALTER TABLE site_collections
  ADD COLUMN IF NOT EXISTS origin_session_id uuid REFERENCES creation_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_collections_origin_session
  ON site_collections (origin_session_id);

COMMENT ON COLUMN site_collections.origin_session_id IS
  'The Creation Session whose idea this collection was provisioned for. Null when the collection was created by hand: nobody knows which idea it belongs to, and guessing would attribute submissions to the wrong artifact.';
