-- 0471 — The résumé stops being an integration and becomes an object this platform owns.
--
-- WHAT THIS REPLACES
-- ------------------------------------------------------------------------------
-- A for-hire profile carried FOUR `hired_video_*` columns plus a flat R2 key. Between
-- them they encoded a whole product decision: the résumé lived at hired.video, we
-- provisioned a job-seeker account there on signup, uploaded the file for them to parse,
-- cached their JSON extract locally, and displayed the result by embedding an iframe on
-- an expiring token. When `HIRED_API_KEY` was unset — which is every environment except
-- one — the person got a single un-parsed file and no viewer at all.
--
-- Meanwhile this platform already had the better résumé: the Canvas `resume` object,
-- with an immutable uploaded Original, named derived variants, twelve live-rendered
-- templates, and PDF/DOCX/HTML/Markdown export. It simply was not reachable from the
-- profile. This migration joins the two halves and deletes the seam.
--
-- WHY A POINTER AND NOT A RÉSUMÉ TABLE
-- ------------------------------------------------------------------------------
-- hired.video modelled this as `resumes` + `resume_versions` + master groups. Porting
-- those would have added a fourth résumé representation to a schema that already has
-- three, and would contradict PRD 20's session test: a thing that is AUTHORED, that
-- people can be PRESENT in, and that can be SHARED is not a feature — it is the canvas.
-- A résumé is all three. So the family (original, variants, master, active, template,
-- privacy) lives in the object's own JSONB, and this column is the pointer.
--
--   freelancer_profiles.resume_object_id -> creation_session_objects.id (kind='resume')
--
-- ON DELETE SET NULL, not CASCADE: deleting a résumé must not delete the person.
--
-- WHAT HAPPENS TO EXISTING DATA
-- ------------------------------------------------------------------------------
-- `resume_key` pointed at an R2 object that is NOT deleted here — the bytes survive in
-- the bucket, and the file is re-imported into a Canvas résumé the next time its owner
-- opens their profile (the import path now extracts PDF/DOCX text server-side, which is
-- the capability whose absence made this a third-party integration in the first place).
-- `resume_extract` held a cache of a vendor API response for a vendor we no longer call,
-- so it is dropped rather than migrated. No hired.video id is portable to anything here.

ALTER TABLE freelancer_profiles
  ADD COLUMN IF NOT EXISTS resume_object_id uuid REFERENCES creation_session_objects(id) ON DELETE SET NULL;

-- Resolving "does this person have a résumé" is on the profile read path.
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_resume_object
  ON freelancer_profiles (resume_object_id)
  WHERE resume_object_id IS NOT NULL;

-- THE EMPLOYER'S HALF
-- ------------------------------------------------------------------------------
-- `candidate_resumes` landed with migration 0419 (the PRD 20 hiring domain) and has had
-- no writer since — the ATS had a table for a résumé and no way to get one. Applying now
-- PROJECTS the applicant's master revision into the employer's tenant, which is what
-- keeps a private variant history out of a recruiter's inbox while still giving the
-- matcher something tenant-scoped to read. One snapshot per candidate per employer:
-- re-applying refreshes it rather than appending a near-identical row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_resumes_tenant_candidate
  ON candidate_resumes (tenant_id, candidate_ref);

ALTER TABLE freelancer_profiles
  DROP COLUMN IF EXISTS hired_video_user_id,
  DROP COLUMN IF EXISTS hired_video_connection_id,
  DROP COLUMN IF EXISTS hired_video_resume_id,
  DROP COLUMN IF EXISTS hired_video_claim_url,
  DROP COLUMN IF EXISTS resume_key,
  DROP COLUMN IF EXISTS resume_filename,
  DROP COLUMN IF EXISTS resume_extract;
