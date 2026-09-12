-- 1151 — Re-grade canvas collaborators from `developer` to `contributor`.
--
-- Migration 1150 added the `contributor` tier; `tenantRoleForSessionRole` now seats
-- every NEW board editor/runner/owner there. This moves the people already seated
-- through a canvas invitation under the old rule.
--
-- Identifying them is exact, not heuristic: `seat_kind = 'collaborator'` is written
-- ONLY by the canvas-share motion (migration 1138, `domain/tenant/SeatKind.ts`);
-- every workspace invite writes `'seat'`. So a `collaborator` holding `developer`
-- got that role from a board, never from a manager. Paid-seat developers
-- (`seat_kind = 'seat'`) are untouched, and so is a collaborator a manager has since
-- promoted to `manager`/`owner`.

UPDATE tenant_members
   SET role = 'contributor'
 WHERE seat_kind = 'collaborator'
   AND role = 'developer';

-- Companion invitations not yet redeemed carry the same old grant and would land
-- the invitee as a developer on accept. Same identification, same fix.
UPDATE invitations
   SET role = 'contributor',
       updated_at = NOW()
 WHERE kind = 'tenant'
   AND seat_kind = 'collaborator'
   AND role = 'developer'
   AND state = 'pending';
