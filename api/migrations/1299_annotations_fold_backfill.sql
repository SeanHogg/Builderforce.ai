-- 1299 · PRD 39 §2 — canvas comments into `annotations`, MOVE-phase backfill.
--
-- Idempotent fold of `creation_session_comments` into kernel `annotations`
-- (kind 'comment'), accounted row-by-row in `annotation_fold_ledger` (migration
-- 1298). A source comment is folded exactly once: the ledger's unique key on
-- `source_comment_id` is the idempotency guarantee, so this migration is safe to
-- re-run (push 3 re-runs it to reconcile before the contract drops the table).
--
-- The mapping (PRD 39 §2 field table):
--   id              → annotations.public_id  (clients hold uuid ids; the wire id stays)
--   session_id      → the session's kernel object (objects kind 'creation_session')
--   tenant_id       → from the session (annotations is tenant-NOT-NULL; the old table
--                     has no tenant column)
--   object_id       → anchor.canvasObjectId (the old FK's ON DELETE SET NULL obligation
--                     moves to the domain layer — creationGraphWriter.ts / canvasComments.ts)
--   parent_comment_id → annotations.parent_id (bigserial), resolved AFTER the insert
--                     pass through the ledger, so a parent folded in the same run resolves
--   body, anchor    → same; anchor gains canvasObjectId only when object_id is set
--   mentions        → same
--   created_by      → author_ref (author_kind 'user'; no FK — a deleted user's comment
--                     keeps the ref, it is not set to NULL)
--   resolved_by / resolved_at → same
--
-- Rows whose session has no registry object are skipped and recorded 'skipped'
-- (the registry object is ensured by canvasComments.ts on the next write; a later
-- re-run picks them up).
SET LOCAL lock_timeout = '3s';

-- Pass 1: fold every un-ledgered comment whose session has a registry object.
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

-- Pass 1b: record the genuinely unregistrable rows as skipped so reconciliation
-- sees them instead of silently re-attempting forever.
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

-- Pass 2: resolve parent_id. Done after the insert pass so a parent folded in the
-- same run resolves. The `a.parent_id IS NULL` guard keeps the pass idempotent.
UPDATE annotations a
SET parent_id = p.id, updated_at = a.updated_at
FROM annotation_fold_ledger l
JOIN creation_session_comments c ON c.id = l.source_comment_id
JOIN annotation_fold_ledger lp ON lp.source_comment_id = c.parent_comment_id
JOIN annotations p ON p.id = lp.annotation_id
WHERE l.annotation_id = a.id
  AND a.parent_id IS NULL;
