-- 1298 · PRD 39 §2 — canvas comments into `annotations`, EXPAND phase.
--
-- The fold is expand → move → contract. This migration is the EXPAND only:
-- it adds the columns `annotations` needs to absorb `creation_session_comments`
-- and the fold ledger that makes the later backfill idempotent. NO row is copied
-- here — the move is a later push, gated behind the live annotation gate (the
-- gate itself shipped in the same push as this migration's deploy).
--
-- Columns added (nullable or defaulted, so the old Worker's INSERT/UPDATE of
-- `annotations` names none of them and is unaffected during the deploy window):
--
--   public_id    uuid NOT NULL DEFAULT gen_random_uuid() — the WIRE id of a folded
--                comment. Clients hold uuid comment ids today, so the folded row
--                keeps a uuid; existing rows are backfilled once here and new rows
--                get one from the default, so the fold backfill never mints one.
--   mentions     jsonb — the canvas `mentions` array; backfilled on fold.
--   resolved_by  varchar(64) — who resolved a thread; backfilled on fold.
--                Deliberately varchar, NOT a users FK: kernel takes no sibling
--                schema imports (PRD 20 §6.2), and a deleted user's comments keep
--                the ref rather than being set to NULL.
--
-- Partial expression index for the pin filter (anchor->>'canvasObjectId'):
-- supports object-scoped comment queries once pins fold into anchor.canvasObjectId.
-- The PRD §2 mapping loses the old FK's ON DELETE SET NULL, so deleting a canvas
-- object must clear the pin in the domain layer (canvasComments.ts, push 2).
--
-- annotation_fold_ledger: one row per source comment, the idempotency key of
-- the backfill, keyed by source comment id, reconciled per session on contract.
-- No FK to creation_session_comments — the ledger must outlive the contract push
-- that drops the source table.
--
-- Idempotent / re-runnable; reversible by DROP COLUMN / DROP TABLE.
SET LOCAL lock_timeout = '3s';

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS public_id uuid,
  ADD COLUMN IF NOT EXISTS mentions jsonb,
  ADD COLUMN IF NOT EXISTS resolved_by varchar(64);

-- One-time backfill of existing rows, then the default for new rows, then NOT NULL.
UPDATE annotations SET public_id = gen_random_uuid() WHERE public_id IS NULL;
ALTER TABLE annotations ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
ALTER TABLE annotations ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_annotations_public_id
  ON annotations (public_id);

-- Pin filter once canvas object ids live at anchor->>'canvasObjectId'.
CREATE INDEX IF NOT EXISTS idx_annotations_anchor_object
  ON annotations ((anchor ->> 'canvasObjectId'))
  WHERE anchor ->> 'canvasObjectId' IS NOT NULL;

CREATE TABLE IF NOT EXISTS annotation_fold_ledger (
  id                 bigserial PRIMARY KEY,
  tenant_id          integer NOT NULL,
  source_comment_id  uuid NOT NULL,
  source_session_id  uuid NOT NULL,
  object_id          uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  annotation_id      bigint,
  status             varchar(16) NOT NULL DEFAULT 'pending',
  note               text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_annotation_fold_ledger_source
  ON annotation_fold_ledger (source_comment_id);

CREATE INDEX IF NOT EXISTS idx_annotation_fold_ledger_session
  ON annotation_fold_ledger (tenant_id, source_session_id);
