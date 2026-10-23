-- 1264 · Canvas (creation-session) relations onto the kernel object relations — EXPAND.
--
-- Operator decision (final): a board's members, shares and activity live on the
-- kernel relations of the board's registry object (`objects` kind
-- 'creation_session'), served by `/api/objects/:id/{members,shares,activity}`.
--
-- What was actually duplicated, and what happens to each:
--
--   members   `creation_session_members` held (session, user, role) — the exact fact
--             `memberships` exists to hold. This migration backfills one `memberships`
--             row per member on the board's object, role / joined_at / tenant kept,
--             and the per-member preferences (`invitedBy`, `pinned`, `watchState`) in
--             `memberships.metadata`. From the new Worker on, the board-role gate
--             (`application/creation/sessionAccess.ts`) reads `memberships` ONLY.
--
--   shares    Already kernel: canvas invite links, résumé shares and prospect shares
--             are `share_links` rows on the board's object; invitations have been
--             `invitations` rows (kind 'session') since 0435. Step 1 guarantees every
--             board HAS its object, which those writers used to create lazily.
--
--   activity  No duplicate exists. `creation_session_events` is the ordered,
--             revision-serialised replay log that IS the canvas document's state;
--             `activity_log` is an append-only record of changes. Canvas-only, kept.
--
-- EXPAND / CONTRACT. Migrations run BEFORE the Worker deploys, so this migration
-- changes no table the previous Worker reads: `creation_session_members` keeps its
-- name and every column, and keeps carrying the presence state (and, mirrored by the
-- new Worker, the role) for the length of the deploy window. The CONTRACT — re-run of
-- the backfill, rename to `creation_session_presence`, drop of the access columns —
-- is migration 1270, held until the new Worker is the only one serving.
--
-- Idempotent: safe to re-run (1270 re-runs step 3 for the same reason).

-- ── 1. Every board has its registry object ───────────────────────────────────────
INSERT INTO objects (tenant_id, kind, ref_id, domain, title, archived_at, created_at, updated_at)
SELECT s.tenant_id, 'creation_session', s.id::text, 'canvas', LEFT(s.title, 300), s.archived_at, s.created_at, s.updated_at
FROM creation_sessions s
ON CONFLICT (tenant_id, kind, ref_id) DO NOTHING;

-- ── 2. Kernel memberships that pre-date this fold are not board grants ───────────
-- Until now nothing read `memberships` on a board object, so a row the generic
-- `/api/objects/:id/members` writer put there granted nothing. From here on that table
-- IS the board-role gate, so any such row must not silently become access: retire every
-- active one that has no `creation_session_members` counterpart. Real members are
-- (re-)activated by step 3; rows step 3 already wrote are left alone on a re-run.
UPDATE memberships m
   SET state = 'removed', updated_at = NOW()
  FROM objects o
 WHERE o.id = m.object_id
   AND o.kind = 'creation_session'
   AND m.state = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM creation_session_members csm
      WHERE csm.session_id::text = o.ref_id
        AND csm.user_id = m.member_ref
        AND m.member_kind = 'user'
   );

-- ── 3. Backfill members (role, tenant, joined_at, inviter, preferences) ──────────
INSERT INTO memberships (tenant_id, object_id, member_kind, member_ref, role, state, joined_at, metadata, created_at, updated_at)
SELECT o.tenant_id,
       o.id,
       'user',
       csm.user_id,
       csm.role,
       'active',
       csm.joined_at,
       jsonb_strip_nulls(jsonb_build_object(
         'invitedBy',  csm.invited_by,
         'pinned',     CASE WHEN csm.pinned THEN TRUE END,
         'watchState', NULLIF(csm.watch_state, 'mentions')
       )),
       csm.joined_at,
       NOW()
  FROM creation_session_members csm
  JOIN creation_sessions s ON s.id = csm.session_id
  JOIN objects o ON o.tenant_id = s.tenant_id AND o.kind = 'creation_session' AND o.ref_id = s.id::text
ON CONFLICT (tenant_id, object_id, member_kind, member_ref) DO UPDATE
   SET role       = EXCLUDED.role,
       state      = 'active',
       joined_at  = COALESCE(memberships.joined_at, EXCLUDED.joined_at),
       metadata   = COALESCE(memberships.metadata, '{}'::jsonb) || EXCLUDED.metadata,
       updated_at = NOW();
