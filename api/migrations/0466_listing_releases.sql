-- 0466 — Which version a buyer actually holds, and a place to stage one before selling it.
--
-- ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
-- `publishCreationListing` has always written an IMMUTABLE `snapshots` row per
-- publish and bumped `catalog_items.version`, so the history of every listing is
-- already on disk and complete. Two things were missing on top of it and both
-- hurt the buyer rather than the seller:
--
--  1. `template_licenses` recorded WHO bought WHAT and never WHICH VERSION. The
--     launch and install paths therefore served `catalog_items.body.snapshotId`
--     — whatever is current — so somebody who bought v1.1 and installed a month
--     later silently received v1.4, and if v1.4 was worse they had nowhere to go
--     back to. "You own v1.1" was not a knowable fact.
--
--  2. There was no way to capture a candidate version WITHOUT selling it, so the
--     first time a seller saw the buyer's view of their own creation was on the
--     public URL that was already selling it.
--
-- ── WHY THERE IS NO NEW TABLE ───────────────────────────────────────────────
-- The release history IS the `snapshots` rows: they already carry `object_id`
-- (the listing's registry entry), `reason`, `created_by` and `taken_at`. A
-- `listing_releases` table beside them would be a second copy of a fact that is
-- already stored, which is exactly the duplication the data-model rule forbids.
-- So staging adds a `reason` VALUE (`'stage'`), not DDL — and because the public
-- read pins `reason = 'publication'`, a staged snapshot is unreachable from the
-- marketplace by construction rather than by a visibility flag somebody could
-- get wrong.
--
-- That leaves exactly one column to add.

-- ── The buyer's held version ────────────────────────────────────────────────
-- Nullable, and deliberately so: every licence granted before this migration was
-- granted against whatever was live at the time and there is no honest way to
-- reconstruct which snapshot that was. NULL therefore means "unpinned — serve
-- current", which is precisely the pre-migration behaviour, so no existing buyer
-- changes what they see. Every licence granted from now on is pinned.
--
-- No FK to `snapshots`: a snapshot behind a sold licence must never be deletable,
-- and ON DELETE CASCADE would delete the licence with it while ON DELETE RESTRICT
-- would make a tenant deletion fail on a stranger's purchase. The invariant is
-- upheld by never deleting publication snapshots, which is the same rule that
-- already lets `unpublishCreationListing` leave sold rows in place.
ALTER TABLE template_licenses
  ADD COLUMN IF NOT EXISTS snapshot_id UUID;

COMMENT ON COLUMN template_licenses.snapshot_id IS
  'The publication snapshot this licence was granted against. NULL on licences predating migration 0466, which resolve to the listing''s current snapshot. Never rewritten: an update is a new grant the buyer accepted, not a silent move.';

-- ── Reading a listing''s release rail ───────────────────────────────────────
-- The rail asks "every snapshot for this listing, newest first" on every open of
-- the Releases panel. `idx_snapshots_object` already covers (object_id, taken_at);
-- this adds `reason` so the two tracks — staged candidates and published versions
-- — separate in the index rather than in the application after a full scan of the
-- object''s history.
CREATE INDEX IF NOT EXISTS idx_snapshots_object_reason
  ON snapshots (object_id, reason, taken_at DESC);

-- Buyers holding a given snapshot: read when a seller reverts, to say how many
-- people are on the version they are about to supersede.
CREATE INDEX IF NOT EXISTS idx_template_licenses_snapshot
  ON template_licenses (snapshot_id)
  WHERE snapshot_id IS NOT NULL;
