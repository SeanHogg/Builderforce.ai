-- 1106 · Two generalisations that let the points economy and employer reviews land
--        with ZERO new tables.
--
-- Both halves exist because the coverage map (specs/builderforce/data-model/
-- source-to-target.tsv) already assigns the incoming capability to a primitive this
-- schema owns, and in each case the primitive was one column short of being able to
-- hold it honestly. Adding the column is the whole change; a `points_fraud_flags`
-- table and a `company_reviews` table are what this avoids.
--
-- ── 1 · `alert_events` gains a SUBJECT ───────────────────────────────────────────
--
-- `alert_events` is already "a single firing of a rule (or a system alert)", with the
-- acknowledge/resolve lifecycle and the operator surface that goes with it. What it
-- could not express is an alert ABOUT SOMEBODY: every column describes a metric
-- crossing a threshold for a tenant, project or team, and the points fraud engine
-- raises "this USER closed twenty self-authored tasks in one minute".
--
-- That is a firing, not a new noun — same lifecycle, same queue, same reviewer. So it
-- gains the four facts it was missing rather than a table of its own:
--
--   • subject_kind / subject_ref — WHO or WHAT the alert is about. Nullable, so every
--     existing metric alert stays exactly what it was.
--   • severity — how hard it should push. `alerts.threshold` answers this for a rule-
--     driven firing; a system firing has no rule row to read it from.
--   • evidence — the payload that makes the flag reviewable. Without it a reviewer
--     sees a sentence and has to reconstruct the case by hand, which is how a review
--     queue turns into a queue nobody works.
--
-- The coverage map files `HV points_fraud_flags` under `ledger_entry`, which is wrong
-- and is corrected in the same commit: a fraud flag is not a money movement, it has
-- no denomination and no amount, and filing it in the ledger would put non-money rows
-- in the table every balance on this platform sums over.
--
-- ── 2 · `annotations` gains a MODERATION STATE ───────────────────────────────────
--
-- Employer reviews are `annotations` rows (kind='rating') against a company object —
-- the map's assignment, and the right one: a review is a rating with a body, an
-- author and threaded replies, which is this table exactly.
--
-- The one thing it could not express is that a review is NOT VISIBLE YET. These rows
-- publish user-written claims about NAMED third-party employers, and the operator
-- decision (2026-08-22) is that exposure is opt-in: a review lands `pending` and stays
-- invisible until somebody approves it.
--
-- `resolved_at` already exists and is deliberately NOT reused for this. On a comment
-- it means "this thread is settled", which is a different fact that can be true of a
-- published review and false of a pending one; overloading it would make "is this
-- visible" unanswerable the moment both meanings applied to one row.
--
-- DEFAULT 'published' is what keeps this backward-compatible: every annotation
-- already written is visible and stays visible, and only the writers that opt into
-- moderation (reviews of employers) pass 'pending'.

ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS subject_kind varchar(24);
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS subject_ref  varchar(64);
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS severity     varchar(16) NOT NULL DEFAULT 'medium';
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS evidence     jsonb;

-- The review queue's only query: open firings about a subject, newest first.
CREATE INDEX IF NOT EXISTS idx_alert_events_subject
  ON alert_events (tenant_id, subject_kind, subject_ref, created_at DESC);

ALTER TABLE annotations ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'published';

-- The public read: approved rows for one object. Partial, because the pending and
-- rejected rows are a moderation-queue concern and never appear on a public page.
CREATE INDEX IF NOT EXISTS idx_annotations_published
  ON annotations (object_id, kind, created_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- The moderation queue: everything awaiting a decision in one workspace.
CREATE INDEX IF NOT EXISTS idx_annotations_moderation
  ON annotations (tenant_id, status, created_at DESC)
  WHERE status <> 'published';
