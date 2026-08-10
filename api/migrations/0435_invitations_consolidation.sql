-- 0435_invitations_consolidation.sql
--
-- PRD 20 §5 step 5, family 1: the invitation tables move onto the kernel
-- primitive and are dropped.
--
-- `invitation` was declared in §2 as "invite somebody to something — absorbs 9
-- tables", and until now it was an empty table beside two full ones.
-- `tenant_invitations` invited you to a workspace; `creation_session_invites`
-- invited you to a canvas session. They differed in what they invited you TO,
-- which is a `kind` and an `object_id`; everything else — address, role, state,
-- sender, expiry, accepted/revoked timestamps — was the same column twice.
--
-- §5 step 5 names this family FIRST because it is small and self-contained, and
-- because the point of doing it first is to prove the pattern: backfill, cut the
-- reads over, drop. All three happen here and in the same release as the code
-- that reads the new table — a backfill that lands without its cutover is two
-- sources of truth, which is the problem this document is about.
--
-- ATOMIC. `scripts/migrate.mjs` wraps each file in one transaction, so the copy
-- and the drop either both happen or neither does. Every INSERT is idempotent on
-- the primary key it carries across, so a replay is a no-op rather than a
-- duplicate-key failure.
--
-- IDS ARE CARRIED ACROSS, not regenerated: a pending workspace invite whose id
-- is sitting in somebody's open browser tab keeps working.
--
-- THE TOKEN. `invitations.token_hash` is NOT NULL and UNIQUE because for the
-- primitive the token IS the grant. A workspace invite never had one — it is
-- redeemed by matching the address at sign-in — so its row gets a deterministic
-- 64-character value derived from its own id. There is no preimage: nobody can
-- present a token that hashes to it, which is precisely the property a
-- token-less invite needs. Session invites carry their real `token_hash`
-- unchanged, so links already in inboxes keep working.

-- ── workspace invitations ────────────────────────────────────────────────────

INSERT INTO invitations (
  id, tenant_id, object_id, kind, email, invitee_ref, role, token_hash,
  state, message, invited_by, expires_at, accepted_at, revoked_at, created_at, updated_at
)
SELECT
  ti.id,
  ti.tenant_id,
  NULL,
  'tenant',
  LOWER(TRIM(ti.email)),
  NULL,
  ti.role::text,
  MD5(ti.id::text) || MD5(ti.id::text || 'tenant_invitations'),
  CASE
    WHEN ti.revoked_at IS NOT NULL THEN 'revoked'
    WHEN ti.accepted_at IS NOT NULL THEN 'accepted'
    ELSE COALESCE(ti.status, 'pending')
  END,
  NULL,
  ti.invited_by_user_id,
  NULL,
  ti.accepted_at,
  ti.revoked_at,
  ti.created_at,
  NOW()
FROM tenant_invitations ti
ON CONFLICT (id) DO NOTHING;

-- ── canvas-session invitations ───────────────────────────────────────────────
--
-- A session invite targets an OBJECT, so the sessions holding invites are
-- registered first. `registryProjection.ts` would do this on its next tick, but
-- an invitation with a null object is an invitation to nothing, so it happens
-- here rather than up to a day later.

INSERT INTO objects (tenant_id, kind, ref_id, domain, title, updated_at)
SELECT DISTINCT
  cs.tenant_id,
  'creation_session',
  cs.id::text,
  'canvas',
  LEFT(COALESCE(cs.title, ''), 300),
  NOW()
FROM creation_sessions cs
WHERE cs.tenant_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM creation_session_invites i WHERE i.session_id = cs.id)
ON CONFLICT (tenant_id, kind, ref_id) DO UPDATE SET updated_at = NOW();

INSERT INTO invitations (
  id, tenant_id, object_id, kind, email, invitee_ref, role, token_hash,
  state, message, invited_by, expires_at, accepted_at, revoked_at, created_at, updated_at
)
SELECT
  i.id,
  i.tenant_id,
  o.id,
  'session',
  LOWER(TRIM(i.email)),
  i.accepted_by,
  i.role,
  i.token_hash,
  CASE
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.accepted_at IS NOT NULL THEN 'accepted'
    WHEN i.expires_at <= NOW() THEN 'expired'
    ELSE 'pending'
  END,
  NULL,
  i.created_by,
  i.expires_at,
  i.accepted_at,
  i.revoked_at,
  i.created_at,
  NOW()
FROM creation_session_invites i
JOIN creation_sessions cs ON cs.id = i.session_id
JOIN objects o
  ON o.tenant_id = cs.tenant_id
 AND o.kind = 'creation_session'
 AND o.ref_id = cs.id::text
ON CONFLICT (id) DO NOTHING;

-- ── contract ─────────────────────────────────────────────────────────────────
--
-- Dropped in the same transaction as the copy. Keeping them "just in case" is
-- how a table nobody reads keeps being written to by the one path somebody
-- forgot, which is exactly the drift `check-shape-lint.mjs` counts.

DROP TABLE IF EXISTS creation_session_invites;
DROP TABLE IF EXISTS tenant_invitations;
