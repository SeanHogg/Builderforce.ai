-- Structured 5-Why capture — the RCA chain as ROWS instead of a paragraph.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
-- The post-mortem already had somewhere to write a root cause: `prod_incidents.
-- root_cause`, plus the free-text `contributing_factors` / `what_went_wrong`
-- fields the RCA form collects. The incidents surface then rendered a fishbone by
-- SPLITTING those blobs on newlines and calling each fragment a "cause".
--
-- That renders a LIST, and a 5-Why is not a list. Its whole content is the
-- ORDER — why₂ is an answer to why₁, why₃ an answer to why₂, and the value of
-- the technique is precisely the causal edge between adjacent steps. Splitting a
-- textarea on '\n' throws that edge away: nothing in the stored data says which
-- line caused which, so nothing downstream can tell a chain from a brainstorm.
-- Two teams could write the identical five lines in opposite order and the
-- database could not distinguish them.
--
-- So the chain gets rows, one per step, and `step_no` carries the thing the blob
-- could not (3NF: the ordinal is the key, not an accident of line position).
-- `is_root` marks the terminal step — the answer the remediation actually
-- attaches to. It is a FLAG rather than "the last row" because a chain can be
-- captured before the team is willing to call any step the root, and "deepest so
-- far" is not the same claim as "this is the cause".
--
-- ── WHY NOT A JSONB COLUMN ON prod_incidents ────────────────────────────────
-- Because the steps are queried, not just displayed: "which systems keep bottoming
-- out on the same root cause" is a GROUP BY over terminal steps, and a JSON array
-- makes that a scan-and-parse. Rows also let a step be edited, re-ordered or
-- removed without rewriting the document that holds its siblings.
--
-- ── TENANCY ─────────────────────────────────────────────────────────────────
-- `tenant_id` is carried directly rather than inferred through `incident_id`,
-- exactly like `incident_events` and `prod_incident_implicated_tasks`. The
-- tenant-scope guard can only check a predicate it can SEE on the table being
-- queried; a child that reaches its tenant through a join is unscoped by
-- construction, and one forgotten join condition then reads another workspace's
-- root causes.

CREATE TABLE IF NOT EXISTS postmortem_whys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES prod_incidents(id) ON DELETE CASCADE,
  -- 1-based depth in the ladder. why₁ answers the PROBLEM (the incident title);
  -- why₍ₙ₎ answers why₍ₙ₋₁₎. Contiguous from 1 by construction — the writer
  -- replaces the whole chain, so a gap can never be persisted.
  step_no     integer NOT NULL,
  -- The answer at this depth. Free text on purpose: the discipline is in the
  -- ordering, not in a taxonomy nobody would fill in honestly under an outage.
  statement   text NOT NULL,
  -- The terminal step: the cause remediation attaches to. At most one per chain,
  -- enforced below rather than by convention.
  is_root     boolean NOT NULL DEFAULT false,
  created_by  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- One statement per depth per incident. This is what makes the row set a CHAIN
-- rather than a bag: two rows claiming step 3 would leave the order ambiguous
-- again, which is the exact defect this table was added to fix.
CREATE UNIQUE INDEX IF NOT EXISTS uq_postmortem_whys_step
  ON postmortem_whys (incident_id, step_no);

-- At most ONE root per chain. Partial-unique rather than a service-side check,
-- because two roots make "the cause" a question with two answers and every
-- consumer downstream (the RCA render, the remediation link, the aggregate over
-- recurring causes) would then silently pick one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_postmortem_whys_root
  ON postmortem_whys (incident_id) WHERE is_root;

-- The read path: every chain for an incident, tenant-scoped, in ladder order.
CREATE INDEX IF NOT EXISTS idx_postmortem_whys_incident
  ON postmortem_whys (tenant_id, incident_id, step_no);
