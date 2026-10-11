-- 1206 · Where a job posting was published, as the board confirmed it (FO-B4).
--
-- WHY A TABLE. The canvas `jobPosting` documented `distribution` as `{board, status,
-- postedAt, url}` "written by the distribute action against a connected job board",
-- and the hiring connectors (`connectors/defaults/hiring.ts`) could each create a
-- posting — but there was nowhere to keep the board's ANSWER. A publication that is
-- recorded only on a canvas card is a claim the next card edit can erase; one recorded
-- nowhere means re-publishing duplicates the posting on the board, because nothing
-- remembers it went out.
--
-- ONE ROW PER (posting, board). `connector_key` names the board — the same key
-- `job_applications.source` carries for an application that board produced, which is
-- how applicant volume attributes back to it. `connection_id` names the credentials
-- the publish ran under; it is a cross-domain reference (integrations owns
-- `connector_connections`), so the hiring schema holds it as a plain column and the
-- constraint lives here, ON DELETE SET NULL: removing a connection must not erase the
-- record that a posting went out.
--
-- `status` is `posted` only when the board's response carried its id for the posting
-- (read through the manifest's `response` mapping). A 2xx with no id is a `failed` row
-- with the reason in `last_error` — never a confirmed row nobody can prove.
--
-- The single writer is `application/hiring/distributePosting.ts`.

CREATE TABLE IF NOT EXISTS job_posting_distributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_posting_id  varchar(36) NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  connector_key   varchar(64) NOT NULL,
  connection_id   uuid REFERENCES connector_connections(id) ON DELETE SET NULL,
  external_id     varchar(255),
  url             varchar(1000),
  status          varchar(16) NOT NULL CHECK (status IN ('posted', 'failed')),
  posted_at       timestamp,
  last_error      text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  -- A confirmed row names the board's id for what it confirmed. The rule the writer
  -- follows, made a property of the table so no second writer can break it.
  CONSTRAINT ck_job_posting_distributions_posted_has_id
    CHECK (status <> 'posted' OR (external_id IS NOT NULL AND posted_at IS NOT NULL))
);

-- The identity, and the upsert's conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_posting_distributions_board
  ON job_posting_distributions (tenant_id, job_posting_id, connector_key);
