-- 1270 · Canvas members onto the kernel — final CATCH-UP of the 1264 deploy window.
--
-- The previous Worker (1264's) still mirrors every settled board role onto
-- `creation_session_members`, and an older isolate may have seated or removed members
-- there natively. This migration runs before the Worker that stops mirroring deploys,
-- and carries the last of those window writes onto the kernel `memberships` rows the
-- board-role gate reads:
--
--   1.  Re-run 1264's step-3 backfill, so any member seated only in
--       `creation_session_members` (no kernel membership, or one retired BEFORE that
--       row was written) becomes a kernel member. Active kernel memberships are never
--       overwritten: the new Worker has been the authority for them since 1264.
--   1b. Carry the window REMOVALS: an active board membership whose
--       `creation_session_members` row was deleted is retired (1264 step 2's rule).
--
-- The table keeps its name and its access columns here; dropping those columns is the
-- next canvas contract release, once no Worker that mirrors them is serving.
--
-- Runs ONCE: the migration ledger prevents a re-run, and nothing here may rely on being
-- re-runnable. The upsert only revives retired rows older than the window row, so step 1
-- is safe to repeat. Step 1b is NOT: it is a no-op on a re-run only while a Worker that
-- mirrors legacy roles onto `creation_session_members` is serving. Once this release's
-- code is live, board members are seated in `memberships` alone, so 1b would retire
-- every one of them. Step 1b must never be re-run, by hand or by copying it into a
-- later migration, after this release's code is live. Skipped when the access columns
-- are already gone.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'creation_session_members'
       AND column_name = 'role'
  ) THEN
    RAISE NOTICE '1270: creation_session_members access columns already dropped — nothing to catch up';
    RETURN;
  END IF;

  -- ── 1. Catch-up backfill (window writes by the previous Worker) ─────────────────
  INSERT INTO objects (tenant_id, kind, ref_id, domain, title, archived_at, created_at, updated_at)
  SELECT s.tenant_id, 'creation_session', s.id::text, 'canvas', LEFT(s.title, 300), s.archived_at, s.created_at, s.updated_at
    FROM creation_sessions s
  ON CONFLICT (tenant_id, kind, ref_id) DO NOTHING;

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
         metadata   = (COALESCE(memberships.metadata, '{}'::jsonb) - 'invitedBy') || EXCLUDED.metadata,
         joined_at  = EXCLUDED.joined_at,
         updated_at = NOW()
   WHERE memberships.state <> 'active'
     AND memberships.updated_at < EXCLUDED.joined_at;

  -- ── 1b. Catch-up of the previous Worker's REMOVALS ───────────────────────────────
  -- The previous Worker took a member off a board by deleting their
  -- `creation_session_members` row; it never touched `memberships`, so that kernel
  -- membership is still active and still a grant. Throughout the window every writer
  -- that seats a board member also wrote this table (the previous Worker natively, the
  -- new one through its legacy-role mirror and the owner row), the generic object
  -- members writer is closed to boards, and 1264 step 2 retired every active board
  -- membership without a row here. So an ACTIVE board membership with no row here was
  -- removed by the previous Worker in the window: retire it (the same rule as 1264
  -- step 2, re-run for the window), so the removal takes effect.
  UPDATE memberships m
     SET state = 'removed', updated_at = NOW()
    FROM objects o
   WHERE o.id = m.object_id
     AND o.kind = 'creation_session'
     AND m.state = 'active'
     AND m.member_kind = 'user'
     AND NOT EXISTS (
       SELECT 1 FROM creation_session_members csm
        WHERE csm.session_id::text = o.ref_id
          AND csm.user_id = m.member_ref
     );
END $$;
