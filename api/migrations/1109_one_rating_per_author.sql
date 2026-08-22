-- 1109 · One rating per author per subject, enforced by the database.
--
-- ── WHAT THIS REPLACES ──────────────────────────────────────────────────────────
-- hired.video's `reviews` table carried `uniq_reviews_subject_user (subject_type,
-- subject_id, user_id)` and documented the consequence in its own header: "the
-- (subject_type, subject_id, user_id) tuple is unique, so a re-submit upserts."
--
-- That rule is the whole integrity of a review system. Without it one person can
-- post fifty reviews of the same employer and the aggregate rating is whatever
-- the most motivated party says it is — which is not a display bug, it is the
-- feature not working. It cannot be enforced in application code either: two
-- concurrent submits both read "no existing review" and both insert.
--
-- `annotations` already holds every rating on this platform (kind='rating',
-- `value` = the score) keyed by `object_id`, which is a REAL foreign key into the
-- `objects` registry rather than the source product's untyped
-- (subject_type, subject_id) pair. What it did not have is this constraint.
--
-- ── WHY PARTIAL, ON THREE COUNTS ────────────────────────────────────────────────
--   • `kind = 'rating'` — comments, notes, tags and reactions are deliberately
--     repeatable. A person may leave twenty comments on one object; they may
--     leave one rating. Making the index total would break every other kind.
--   • `deleted_at IS NULL` — this table soft-deletes. Without the predicate,
--     withdrawing a review would permanently block that person from ever
--     reviewing that subject again, because the tombstone would still occupy the
--     slot.
--   • `author_ref IS NOT NULL` — an anonymous or system-authored rating has no
--     author to be unique per, and NULLs would not collide anyway; stating it
--     keeps the index smaller and the intent readable.
--
-- `object_id` is globally unique, so the tenant is already implied by it and does
-- not belong in the key.
--
-- ── EXISTING ROWS ───────────────────────────────────────────────────────────────
-- Created CONCURRENTLY-less on purpose: this runs against a table whose rating
-- rows are, at the time of writing, zero. Should a duplicate ever pre-exist, this
-- statement fails loudly at migrate time — which is the correct outcome, because
-- silently choosing which of two people's reviews to discard is not a decision a
-- migration may make.

CREATE UNIQUE INDEX IF NOT EXISTS uq_annotations_one_rating_per_author
  ON annotations (object_id, author_ref)
  WHERE kind = 'rating' AND deleted_at IS NULL AND author_ref IS NOT NULL;

-- The public read for a subject's reviews: approved rows, newest first. The
-- 1106 index covers (object_id, kind, created_at) for published rows already;
-- this one carries `value` so the AGGREGATE (count + mean) is answerable from the
-- index without touching the heap, which is the query every company card runs.
CREATE INDEX IF NOT EXISTS idx_annotations_rating_aggregate
  ON annotations (object_id, value)
  WHERE kind = 'rating' AND status = 'published' AND deleted_at IS NULL;
