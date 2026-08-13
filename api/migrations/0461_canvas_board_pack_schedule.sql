-- 0461 — A canvas frame, delivered on a cadence.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- `canvasExports.ts` renders any canvas object to .pptx/.xlsx/.docx/.pdf on
-- demand, and `report_schedules` already dispatches a report to recipients on a
-- daily/weekly/monthly cadence with an advancing watermark. The two had never
-- been introduced to each other, so the two standing obligations of a finance
-- function — the monthly investor update and the board pack — were hand-
-- assembled from the board every single period. That is precisely the recurring
-- work "idea to REAL" claims to remove, and a `frame` was already the right unit
-- of delivery: it is the object that GROUPS the tiles a pack is made of.
--
-- ── WHY A NEW ENUM VALUE AND NOT A NEW TABLE ────────────────────────────────
-- A board pack is a report with a different generator. It has the same
-- recipients, the same cadence vocabulary, the same delivery hour, the same
-- watermark and the same "advance even on failure so a broken schedule cannot
-- retry-storm" rule that `runDueReports` already implements. A `board_pack_
-- schedules` table would be `report_schedules` with one extra column, which
-- PRD 20 §3.1 names as the shape to collapse rather than create.
--
-- ── WHY subject_ref RATHER THAN A canvas_frame_id COLUMN ────────────────────
-- The existing five report types are computed from the tenant and need no
-- subject; a board pack is ABOUT one frame on one canvas. A typed FK to a canvas
-- frame would be a polymorphic-FK violation the moment a sixth report type is
-- about something else (a project, a portfolio), which `check-polymorphic-fk`
-- exists to catch. So it is a nullable opaque reference the generator resolves,
-- the same shape `payback_period.subject_ref` and `roi_timeline_entries.
-- subject_ref` already use in this schema.
--
-- Nullable, with no backfill: every existing row is one of the five computed
-- types and correctly has no subject.

ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'board_pack';

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS subject_kind varchar(32),
  ADD COLUMN IF NOT EXISTS subject_ref  varchar(160);

COMMENT ON COLUMN report_schedules.subject_kind IS
  'What this schedule is ABOUT when the report type needs a subject: ''canvas_frame'' for a board pack. Null for the five computed report types, which are about the tenant.';
COMMENT ON COLUMN report_schedules.subject_ref IS
  'Opaque reference to the subject — for ''canvas_frame'', "<sessionId>:<frameObjectId>". Resolved by the generator, never joined; see the polymorphic-FK note in this migration.';

-- A schedule that names a subject must say what kind of subject it is, and one
-- that names a kind must name the subject. Half a reference is a schedule that
-- fires forever and delivers nothing, which is worse than one that was never
-- created — it looks configured.
ALTER TABLE report_schedules
  DROP CONSTRAINT IF EXISTS ck_report_schedules_subject;
ALTER TABLE report_schedules
  ADD CONSTRAINT ck_report_schedules_subject
  CHECK ((subject_kind IS NULL) = (subject_ref IS NULL));

CREATE INDEX IF NOT EXISTS idx_report_schedules_subject
  ON report_schedules (tenant_id, subject_kind, subject_ref);
