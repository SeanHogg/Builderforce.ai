-- 0928 — Quality collectors: a rotatable ingest key, and a counter for the events
-- the router threw away (ROADMAP QUAL-7 + QUAL-8).
--
-- ── QUAL-7 · THE KEY COULD NOT BE ROTATED ───────────────────────────────────
-- `error_collectors.key_hash` was written exactly once, at creation, and the raw
-- `bfq_…` key was shown exactly once. That is the right shape for minting, and it
-- left no way to REPLACE the key: a key pasted into a public repo, mailed to a
-- contractor, or simply aged out could only be retired by deleting the collector
-- — which cascades away its integrations, mapping rules and error groups. The
-- credential could not be changed without destroying the data it collected.
--
-- Rotation is not a single-column swap, because the key is embedded in software
-- that is ALREADY DEPLOYED (a browser bundle, a container image, an OTLP
-- exporter config). A hard cutover would silently drop every event until each of
-- those redeploys. So a rotation keeps the OLD hash accepted for a bounded grace
-- window: `previous_key_hash` + `previous_key_expires_at`. The ingest resolver
-- accepts either, and the grace hash stops being accepted the moment the window
-- closes — it does not need a sweep to expire it, because the expiry is a
-- predicate on the read.
--
-- ── QUAL-8 · UNROUTABLE EVENTS WERE DROPPED IN SILENCE ──────────────────────
-- `ingestErrorEvents` returns `{ accepted, dropped }`, and `dropped` folded two
-- unrelated facts together: an event that BLEW UP mid-upsert, and an event a
-- tenant-level collector could not route to any project (no mapping rule matched
-- and no `default_project_id` is set). The second is a CONFIGURATION defect with
-- a fix the operator can perform, and the only place the number appeared was an
-- HTTP response body nobody reads — a misconfigured collector looked identical
-- to a quiet one. Both counters live on the collector now, so the collector list
-- can say "1,412 events arrived and were discarded because nothing routes them".
--
-- All five columns are additive with safe defaults; no backfill is possible or
-- needed (the discarded events were never stored).

ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS previous_key_hash VARCHAR(64);
ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS previous_key_expires_at TIMESTAMP;
ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS key_rotated_at TIMESTAMP;
ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS unmapped_event_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE error_collectors ADD COLUMN IF NOT EXISTS last_unmapped_at TIMESTAMP;

-- The grace hash is looked up on the ingest hot path exactly like `key_hash`, so
-- it gets the same index. Partial: only rotated collectors carry one, which on a
-- fleet where rotation is rare keeps the index a few rows rather than a full
-- second copy of the table's identity column.
CREATE INDEX IF NOT EXISTS idx_error_collectors_previous_key
  ON error_collectors (previous_key_hash)
  WHERE previous_key_hash IS NOT NULL;
