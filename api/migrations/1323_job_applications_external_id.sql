-- Applicants IMPORTED from a job board carry the board's own id for the application.
--
-- Expand-only: one nullable column. Existing rows (applications made on the platform)
-- stay NULL and are untouched. `importBoardApplicants` is the only writer; with
-- `source` (the board's connector key) it is the dedupe key, so re-running an import
-- upserts rather than appends. The unique index that enforces it is 1324.

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS external_id varchar(255);
