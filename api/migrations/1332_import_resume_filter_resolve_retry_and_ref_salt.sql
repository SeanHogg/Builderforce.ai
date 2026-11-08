-- Round 3 of the board-applicant import (follows 1328). Expand-only: three nullable columns
-- on job_posting_distributions and one small tenant-scoped table. No drops, no backfill, no
-- NOT NULL on an existing table.
--
-- LOCKING, STATED PLAINLY (1328's header only described the index). `ALTER TABLE ... ADD
-- COLUMN` takes an ACCESS EXCLUSIVE lock on job_posting_distributions: for the instant it
-- is held, reads AND writes wait, not just writes. A nullable column with no default is a
-- catalog-only change (no rewrite), so the lock is released as soon as the statement
-- commits, and the table holds one row per (posting, board). The runner applies each file
-- in one transaction, so the three ADDs are one lock acquisition, not three.
--
-- 1. import_resume_token — a board that pages by an opaque token (Lever `next`, Workable
--    `paging.next`) and lists NEWEST FIRST cannot resume from a page NUMBER, so a walk that
--    stopped at a cap stores the board's own token for the next page here. The manifest's
--    `applicants.nextToken` says where the token is in the answer and which request param
--    carries it back. Cleared when the walk reaches the old cursor. varchar(512): a token
--    is opaque and vendor-chosen; a longer one is not stored (the walk starts over).
--
-- 2. board_filter_id — the id the board's applicant list is FILTERED by, when it differs
--    from the id the publication was stored under. Ashby's `jobPosting.create` returns a
--    job-POSTING id while `application.list` filters on the JOB id; the manifest's
--    `applicants.filterIdFrom` names the lookup that turns one into the other, and the
--    answer is cached here so it is resolved once, not every run. NULL = not resolved yet
--    (or the board needs no lookup).
--
-- 3. resolve_retry_at — when a publication whose resolved link collided with another
--    posting's may be retried. It was kept in import_checked_at (pushed 30 days into the
--    future), but that column is the sweep's ROTATION key for the applicant import, so a
--    link conflict also froze the row's applicant import for a month. Its own column keeps
--    the two schedules apart.
ALTER TABLE job_posting_distributions
  ADD COLUMN IF NOT EXISTS import_resume_token varchar(512),
  ADD COLUMN IF NOT EXISTS board_filter_id varchar(255),
  ADD COLUMN IF NOT EXISTS resolve_retry_at timestamp;

-- 4. hiring_ref_salts — the per-tenant random salt the candidate email ref is an HMAC under
--    (boardCandidate.ts). The key used to be derived from the credential-encryption secret,
--    so ROTATING that secret would silently change every ref and make every already-imported
--    person (and every erased person) unrecognisable. The salt is random, stored, and
--    changes only if a row is deleted. No env var exists for a stable hashing secret, and
--    adding one would make a deploy-time setting load-bearing for erasure; a row in the
--    database travels with the data it protects.
--
--    Existing refs were keyed under the old secret; the import this serves has not shipped
--    to a tenant with imported people, so there is nothing to re-key. (If that ever stops
--    being true, re-keying is a backfill over party_roles, not a schema change.)
CREATE TABLE IF NOT EXISTS hiring_ref_salts (
  tenant_id  integer PRIMARY KEY,
  salt       varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- The sweep's link-finding pass skips rows still inside their retry window.
CREATE INDEX IF NOT EXISTS idx_job_posting_distributions_resolve_retry
  ON job_posting_distributions (resolve_retry_at)
  WHERE status = 'posted' AND url IS NULL;
