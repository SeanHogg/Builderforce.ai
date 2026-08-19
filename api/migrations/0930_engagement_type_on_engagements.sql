-- An engagement that can say what SHAPE it is.
--
-- 0924 gave fixed-price work a payment schedule and a funded-before-work gate, and left
-- the gate reading a signal it should never have had to: `freelancer_engagements`
-- carries no engagement shape, so `evaluateWorkGate` was handed `'fixed_bid'` when a
-- schedule existed and `null` when it did not. That is honest about what the row knows
-- and it is wrong in exactly the case the gate exists for — a FIXED-PRICE engagement
-- whose schedule was never written reads as hourly and is never gated, which is the one
-- state where a freelancer is most likely to start work nobody has funded.
--
-- ── WHY THE COLUMN AND NOT A JOIN ────────────────────────────────────────────────
-- The shape does live on `job_postings.engagement_type` (0293), and for an engagement
-- created by accepting a proposal it could be joined back. But the OTHER creation path —
-- `POST /api/engagements`, the direct hire — takes no job at all, so there is nothing to
-- join to and the question would be unanswerable for exactly the engagements a person
-- created by hand. A column that is null for half its rows is not a denormalisation
-- decision, it is an absent fact.
--
-- So this is a copy, and it is declared as one under the 3NF rule's escape clause: a
-- DENORMALISATION WITH A WRITTEN REASON AND A SINGLE WRITER. The reason is above; the
-- single writer is the moment of hire. `application/marketplace/engagementShape.ts`
-- owns the value — the accept path derives it from the posting, the direct-hire path
-- takes it from the request — and nothing else ever writes this column. It is the shape
-- AT THE TIME OF HIRE, which is what the gate must judge against: repointing it later
-- from a posting that has since been edited would change whether work already done was
-- authorised.
--
-- Values match `job_postings.engagement_type` exactly rather than inventing a narrower
-- vocabulary, so the two can be compared without a mapping table that would then be a
-- third place the shape is stated.

ALTER TABLE freelancer_engagements
  ADD COLUMN IF NOT EXISTS engagement_type varchar(20);

-- No CHECK constraint and no NOT NULL, deliberately, and both for the same reason:
-- every engagement that already exists predates this column and there is no way to
-- recover what it was hired as. NULL means "not stated", which the gate reads as
-- not-fixed-price — the same answer those rows get today, so applying this migration
-- changes no existing engagement's behaviour. `ENGAGEMENT_TYPES` in the application
-- layer is the vocabulary; a CHECK here would be the second place it is written down.

-- Backfill the engagements whose shape IS recoverable: those created by accepting a
-- proposal against a posting that declared one. Matched on (tenant, freelancer) because
-- `freelancer_engagements` holds no job reference — which is the same absent link the
-- column exists to replace, and the reason this backfill is best-effort rather than
-- complete. Only unambiguous matches are written: a freelancer hired by one workspace
-- against two postings of DIFFERENT shapes is left null rather than guessed at.
UPDATE freelancer_engagements e
   SET engagement_type = m.engagement_type
  FROM (
        SELECT p.tenant_id,
               pr.freelancer_user_id,
               MIN(p.engagement_type) AS engagement_type
          FROM job_postings p
          JOIN job_proposals pr ON pr.job_id = p.id AND pr.status = 'accepted'
         WHERE p.engagement_type IS NOT NULL
         GROUP BY p.tenant_id, pr.freelancer_user_id
        HAVING COUNT(DISTINCT p.engagement_type) = 1
       ) m
 WHERE e.engagement_type IS NULL
   AND e.tenant_id = m.tenant_id
   AND e.freelancer_user_id = m.freelancer_user_id;

-- The gate's read: "every fixed-price engagement in this workspace".
CREATE INDEX IF NOT EXISTS idx_engagements_tenant_type
  ON freelancer_engagements (tenant_id, engagement_type);
