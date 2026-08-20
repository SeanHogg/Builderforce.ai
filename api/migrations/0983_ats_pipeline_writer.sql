-- 0983_ats_pipeline_writer.sql
--
-- The ATS gets a writer: reconcile `job_applications` with the postings it applies to,
-- and give an offer ONE place to record the signature request it was sent as.
--
-- NOT a regeneration of 0419. `0419_hiring_domain.sql` is generated from
-- src/infrastructure/database/schema/hiring.ts and its header forbids hand-editing the
-- DDL, but it has also already been applied everywhere — rewriting it in place would
-- change a migration environments have run, which is the one thing a forward-only
-- sequence must not do. So the Drizzle module changed and this is the forward migration
-- that carries the change to a live database. Both files now say the same thing.
--
-- ── DECISION 1 · job_applications.job_posting_id INTEGER → VARCHAR(36) ──────────────
--
-- The two halves of hiring were designed independently and could not join:
--
--   * the ATS half (0419) is integer-keyed with `varchar(64)` `candidate_ref`s;
--   * the marketplace half (0273/0293) keys `job_postings.id` as `varchar(36)` and
--     references people by `freelancer_user_id`.
--
-- `job_applications.job_posting_id INTEGER` therefore could not hold a posting id at
-- all, and that is the mechanical reason this table never got a writer: `admitCandidate`
-- registers the party role and snapshots the résumé, and then has nowhere to record WHAT
-- was applied to. Every downstream capability — the pipeline, the funnel's source
-- breakdown, decisions, offers — needs that link.
--
-- The column is WIDENED to match the real key rather than bridged. The rejected
-- alternative was resolving a posting by title, and matching two identifier spaces by
-- string is precisely the defect the party module's own docstring records removing ("a
-- ref derived from a display name would merge two people called John Smith").
--
-- EXISTING ROWS. There are none to preserve, and that is checkable rather than assumed:
-- before this migration `job_applications` had no writer anywhere in the codebase —
-- `application/domains/hiring/entities.ts` registered it for the generic entity layer
-- and nothing inserted into it. The statements below are still written to be correct if
-- an environment somehow holds rows:
--
--   * the cast is explicit (`USING job_posting_id::varchar(36)`), so an integer value
--     becomes its own digits rather than failing the ALTER;
--   * any value that does not name a real posting is then set to NULL, because a
--     dangling reference is worse than an absent one — an application that claims a
--     posting that does not exist would show on that posting's board as a candidate
--     nobody can open. A NULL says "we do not know which posting", which is true.
--
-- The foreign key is added afterwards. 0419's module comment states the domain rule —
-- "cross-domain references are plain columns; the foreign key is declared in the
-- migration" — and this is that declaration. ON DELETE SET NULL, not CASCADE: deleting a
-- requisition must not delete the record that somebody applied to it, which is the
-- record a discrimination claim is answered with.
--
-- ── DECISION 2 · offer_letters.signature_request_id ─────────────────────────────────
--
-- Sending an offer routes through the existing signature engine
-- (`application/signature/signatureEngine.ts`), the same way
-- `legalDocumentStore.requestLegalDocumentSignature` does. The engine owns "is it
-- signed"; this column is how an offer names its request, and it is what makes sending
-- idempotent — an offer that already has one cannot mint a second. Without it the only
-- place to put the id would be `terms` jsonb, where nothing could enforce that.
--
-- Idempotent: replayable against an environment at any point in the sequence.

-- ── 1 · widen the posting reference ────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_applications'
      AND column_name = 'job_posting_id'
      AND data_type <> 'character varying'
  ) THEN
    -- The unique index covers this column; Postgres rebuilds it with the type change.
    ALTER TABLE job_applications
      ALTER COLUMN job_posting_id TYPE varchar(36) USING job_posting_id::varchar(36);
  END IF;
END $$;

-- Orphan any reference that does not name a real posting. Expected to affect zero rows:
-- nothing has ever written this table.
UPDATE job_applications
   SET job_posting_id = NULL
 WHERE job_posting_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM job_postings WHERE job_postings.id = job_applications.job_posting_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_job_applications_posting'
  ) THEN
    ALTER TABLE job_applications
      ADD CONSTRAINT fk_job_applications_posting
      FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 2 · an offer's signature request ───────────────────────────────────────────────

ALTER TABLE offer_letters
  ADD COLUMN IF NOT EXISTS signature_request_id integer REFERENCES signature_requests(id) ON DELETE SET NULL;

-- One open offer per candidate per application. The pipeline writer refuses a second
-- draft in the application layer; this is the same rule where it cannot be raced, and it
-- is partial because a DECLINED offer followed by a revised one is a legitimate history
-- rather than a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_letters_open
  ON offer_letters (tenant_id, application_id, candidate_ref)
  WHERE status IN ('draft', 'approved', 'sent');

-- The board reads one pipeline's OPEN entries, ordered. Without this it is a scan of
-- every entry the tenant ever recorded, filtered down to the handful still live.
CREATE INDEX IF NOT EXISTS idx_job_pipeline_entries_open
  ON job_pipeline_entries (tenant_id, pipeline_ref, position)
  WHERE exited_at IS NULL;

-- Decisions are read per candidate on the drawer, not only per application: an
-- application id is null for a candidate sourced directly into a pipeline.
CREATE INDEX IF NOT EXISTS idx_hiring_decisions_candidate
  ON hiring_decisions (tenant_id, candidate_ref, decided_at);
