-- 1138 — A canvas collaborator is not a paid seat.
--
-- THE BUG. Sharing a canvas creates a companion workspace invitation, because
-- canvas reads are tenant-scoped and a guest with no `tenant_members` row can
-- never resolve the board. That companion invite was counted against
-- `PlanLimits.maxSeats`, which is 1 on Free AND on Pro — so the owner already
-- filled it, the invitee's membership never landed, and the accept endpoint
-- answered 409 TENANT_SEAT_LIMIT with no way forward. Both plans advertise
-- canvas collaborators (3 on Free, 25 on Pro): the cap being enforced was
-- simply the wrong cap.
--
-- THE FIX. Memberships and invitations now say what they cost. 'seat' is a
-- workspace member and is what `maxSeats` governs; 'collaborator' is a canvas
-- guest and is governed by `maxCreationSessionCollaborators` at invite time.
-- Existing rows are seats, which is correct: every one of them was created by
-- the workspace-invite motion.

ALTER TABLE tenant_members
  ADD COLUMN IF NOT EXISTS seat_kind VARCHAR(16) NOT NULL DEFAULT 'seat';

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS seat_kind VARCHAR(16) NOT NULL DEFAULT 'seat';

-- `tenant_members` never had a uniqueness constraint, so the repository could
-- only "replace" a roster by deleting every row and re-inserting it — which
-- dropped each member's per-seat spend cap and notify state (migration 0359)
-- on every add, remove or role change. Collapse any duplicates that shape
-- allowed, keeping the earliest row and the most permissive state, then make
-- the pair unique so the write can become an upsert.
WITH ranked AS (
  SELECT id,
         tenant_id,
         user_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, user_id ORDER BY id) AS rn
    FROM tenant_members
), survivors AS (
  SELECT tenant_id, user_id,
         BOOL_OR(is_active) AS is_active,
         MIN(joined_at)     AS joined_at
    FROM tenant_members
   GROUP BY tenant_id, user_id
)
UPDATE tenant_members m
   SET is_active = s.is_active,
       joined_at = s.joined_at
  FROM ranked r
  JOIN survivors s ON s.tenant_id = r.tenant_id AND s.user_id = r.user_id
 WHERE m.id = r.id AND r.rn = 1;

DELETE FROM tenant_members m
 USING (
   SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, user_id ORDER BY id) AS rn
     FROM tenant_members
 ) d
 WHERE d.id = m.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_members_tenant_user
  ON tenant_members (tenant_id, user_id);

-- The seat tally reads exactly these three columns.
CREATE INDEX IF NOT EXISTS idx_tenant_members_seat_tally
  ON tenant_members (tenant_id, is_active, seat_kind);
