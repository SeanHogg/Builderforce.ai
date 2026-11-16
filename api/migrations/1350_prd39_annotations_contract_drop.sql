-- 1350 · PRD 39 §2 — canvas comments CONTRACT push: fold any stragglers, then DROP
-- `creation_session_comments` and the canvas-comment portion of the fold ledger.
--
-- WHY. The MOVE phase (migration 1299) folded every comment into kernel
-- `annotations` (kind 'comment') and accounted each row in
-- `annotation_fold_ledger`. The read/write path has run off `annotations` since
-- push 2 (application/canvas/canvasComments.ts); the wire id is `annotations.public_id`,
-- the pin is `anchor.canvasObjectId`, threading is `parent_id`. This push 3
-- contract step removes the now-dead source table. It is the PRD 39 §2
-- "expand → move → contract" sequence's final CONTRACT step.
--
-- ORDER. This file is numbered 1350 — it lands AFTER the fold (1299) and after
-- every push-1/push-2 change (1347/1348/1349). The Drizzle declaration in
-- schema/canvas.ts is removed in the same commit, so code and schema move together.
SET LOCAL lock_timeout = '3s';

-- Reconcile / re-fold any comment written to the old table after 1299 ran (the
-- deploy window where an old Worker still wrote there). Idempotent: the ledger's
-- unique key on source_comment_id means already-folded rows are skipped. This is
-- 1299's Pass 1 + Pass 1b + Pass 2, replayed.
WITH src AS (
  SELECT c.*, s.tenant_id AS t_id, o.id AS kernel_object_id
  FROM creation_session_comments c
  JOIN creation_sessions s ON s.id = c.session_id
  JOIN objects o ON o.tenant_id = s.tenant_id
    AND o.kind = 'creation_session' AND o.ref_id = c.session_id::text
  WHERE NOT EXISTS (
    SELECT 1 FROM annotation_fold_ledger l WHERE l.source_comment_id = c.id
  )
),
ins AS (
  INSERT INTO annotations (
    tenant_id, object_id, kind, author_kind, author_ref,
    body, mentions, anchor, public_id, resolved_by, resolved_at, created_at, updated_at
  )
  SELECT
    t_id, kernel_object_id, 'comment', 'user', created_by,
    body, mentions,
    CASE WHEN c.object_id IS NOT NULL
      THEN coalesce(c.anchor, '{}'::jsonb) || jsonb_build_object('canvasObjectId', c.object_id)
      ELSE c.anchor END,
    c.id, resolved_by, resolved_at, created_at, updated_at
  FROM src c
  RETURNING id, public_id
)
INSERT INTO annotation_fold_ledger (
  tenant_id, source_comment_id, source_session_id, object_id, annotation_id, status
)
SELECT s.t_id, s.id, s.session_id, s.kernel_object_id, i.id, 'folded'
FROM src s JOIN ins i ON i.public_id = s.id;

INSERT INTO annotation_fold_ledger (
  tenant_id, source_comment_id, source_session_id, object_id, annotation_id, status, note
)
SELECT s.tenant_id, c.id, c.session_id,
       coalesce(o.id, '00000000-0000-0000-0000-000000000000'::uuid),
       NULL, 'skipped', 'session has no registry object'
FROM creation_session_comments c
JOIN creation_sessions s ON s.id = c.session_id
LEFT JOIN objects o ON o.tenant_id = s.tenant_id
  AND o.kind = 'creation_session' AND o.ref_id = c.session_id::text
WHERE NOT EXISTS (
  SELECT 1 FROM annotation_fold_ledger l WHERE l.source_comment_id = c.id
);

UPDATE annotations a
SET parent_id = p.id, updated_at = a.updated_at
FROM annotation_fold_ledger l
JOIN creation_session_comments c ON c.id = l.source_comment_id
JOIN annotation_fold_ledger lp ON lp.source_comment_id = c.parent_comment_id
JOIN annotations p ON p.id = lp.annotation_id
WHERE l.annotation_id = a.id
  AND a.parent_id IS NULL;

-- Guard: refuse to drop the table while any source comment is still not folded.
-- Every comment must be represented in `annotations` before the source goes away.
DO $$
DECLARE
  unfolded integer;
BEGIN
  SELECT count(*) INTO unfolded
  FROM creation_session_comments c
  WHERE NOT EXISTS (
    SELECT 1 FROM annotation_fold_ledger l
    WHERE l.source_comment_id = c.id AND l.status = 'folded'
  );
  IF unfolded > 0 THEN
    RAISE EXCEPTION 'creation_session_comments has % unfolded rows; aborting drop', unfolded;
  END IF;
END $$;

-- CONTRACT: drop the source table. CASCADE also drops its two indexes
-- (idx_creation_comments_session, idx_creation_comments_object). The inbound FKs
-- were ON DELETE SET NULL / CASCADE on the child side and live on other tables,
-- so no separate FK drop is needed here.
--
-- The `annotation_fold_ledger` is NOT dropped here: migration 1298 declares it
-- "must outlive the contract push that drops the source table", and push 3
-- reconciles the folded `annotations` rows against it per session. It stays as
-- the read-only fold accounting once the source is gone.
