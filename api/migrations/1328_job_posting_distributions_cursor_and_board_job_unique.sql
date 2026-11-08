-- Two things the board-applicant import and the "link an existing board job" flow need
-- from job_posting_distributions. Expand-only: one nullable column, one partial index,
-- and a one-time repair of rows that would violate it.
--
-- 1. import_cursor — the per-publication cursor of the applicant import
--    (importBoardApplicants.ts). It holds the newest value the board's list action was
--    last read up to (an ISO instant or a numeric id, as the manifest's
--    `applicants.cursorFrom` says), so a run asks the board only for people newer than
--    that instead of re-reading the same first page forever. NULL = never imported, and
--    a board whose manifest declares no cursor simply never writes it.
--
-- 2. ONE BOARD JOB BELONGS TO ONE POSTING. linkBoardJob checks this before it writes, but
--    two managers linking the same Workable job to two postings at once both pass the
--    check; only the database can arbitrate. The unique index below is that arbiter, and
--    the writer maps its 23505 to a 409.
--
--    "A posting holds one publication per board" is ALREADY a constraint —
--    uq_job_posting_distributions_board (tenant_id, job_posting_id, connector_key, from
--    1206) covers every row, so no second index is added for it.
--
-- Existing data: the index could not be built if two confirmed rows already name the same
-- board job (a board that echoed a shared id, or a hand-written row). The keeper is the
-- earliest confirmation; the others are DEMOTED to `failed` with the reason, which is the
-- shape the table's own CHECK allows (a failed row carries no id, url or posted_at) and
-- the shape the writer would have recorded had it refused them.

ALTER TABLE job_posting_distributions
  ADD COLUMN IF NOT EXISTS import_cursor varchar(64);

-- The rest of the import's memory. A board listed NEWEST FIRST cannot move its cursor
-- until a walk reaches the old cursor, so a walk that stops at a cap must say where to
-- resume (import_resume_page) and the newest person it has seen so far
-- (import_pending_cursor, which becomes the cursor when the walk ends). import_failures
-- counts, per board application id, how often the person's own write has failed, so one
-- bad record is quarantined after three tries instead of pinning the cursor forever.
ALTER TABLE job_posting_distributions
  ADD COLUMN IF NOT EXISTS import_resume_page integer,
  ADD COLUMN IF NOT EXISTS import_pending_cursor varchar(64),
  ADD COLUMN IF NOT EXISTS import_failures jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The sweep's rotation key. It is NOT updated_at: that is what a person sees as "last
-- changed", and a pass that rewrote it on every visit would make every publication look
-- freshly edited. Only the scheduled work reads or writes this one.
ALTER TABLE job_posting_distributions
  ADD COLUMN IF NOT EXISTS import_checked_at timestamp;

CREATE INDEX IF NOT EXISTS idx_job_posting_distributions_sweep
  ON job_posting_distributions (import_checked_at)
  WHERE status = 'posted';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, connector_key, external_id
           ORDER BY posted_at ASC NULLS LAST, created_at ASC, id ASC
         ) AS rn
    FROM job_posting_distributions
   WHERE status = 'posted' AND external_id IS NOT NULL
)
UPDATE job_posting_distributions d
   SET status      = 'failed',
       external_id = NULL,
       url         = NULL,
       posted_at   = NULL,
       last_error  = 'Unlinked by migration 1328: the same board job was already linked to another posting.',
       updated_at  = now()
  FROM ranked r
 WHERE d.id = r.id AND r.rn > 1;

-- A plain CREATE UNIQUE INDEX: the runner applies each file in one transaction, where
-- CONCURRENTLY is not allowed (api/scripts/migrate.mjs), so this takes a SHARE lock —
-- writes to the table wait for the heap scan. The table holds one row per (posting,
-- board), a small fraction of job_applications, so the pause is momentary.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_posting_distributions_board_job
  ON job_posting_distributions (tenant_id, connector_key, external_id)
  WHERE status = 'posted';
