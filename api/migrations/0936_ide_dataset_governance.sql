-- A fine-tune corpus that can say what it is allowed to be.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
-- `canvasDataGovernance` already declares the whole model — column classifications, a
-- purpose, a lawful basis, a retention window, a permitted-use list — and
-- `evaluateDatasetUse` already refuses a use the classification forbids. The EXPORT path
-- consults it. The TRAINING path could not, and not because the gate was missing: a
-- canvas `dataset` could not reach a fine-tune corpus at all. `POST /api/ide/training`
-- takes an `ide_datasets.id`, and `ide_datasets` had no classification, no policy, and no
-- link back to the canvas object a person classified — so there was nothing for the gate
-- to read even if the route had asked.
--
-- The asymmetry that makes this the important half: an export produces a copy somebody
-- can later delete. Training produces WEIGHTS, which cannot be un-trained, cannot honour
-- an erasure request, and outlive any lawful basis that can later be withdrawn. Of the
-- two paths, the one that had no gate was the one where the mistake is permanent.
--
-- ── WHY JSONB AND NOT COLUMNS ────────────────────────────────────────────────────
-- `classifications` is one row PER COLUMN of the dataset — a repeating group, which under
-- the 3NF rule is normally its own table. It is stored as a document here for one reason
-- that is not convenience: these rows are not independently queried, updated or joined.
-- They are read as a set, exactly once, by a pure evaluator that takes the whole array,
-- and they are written as a set by whichever surface classified the dataset. A child
-- table would add a join and a second write path to a value that has no independent
-- lifetime, and `packages/creation-canvas-contract/src/dataGovernance.ts` —
-- `normalizeClassifications` / `normalizeUsePolicy` — is the single writer and the single
-- reader of the shape. The canvas object it mirrors stores it the same way, so this is
-- also the shape that already crosses the wire.
--
-- NULL is meaningful and is not "no personal data": it is "nobody classified this". The
-- gate reads an unclassified dataset as having no personal columns, which is the same
-- answer every existing row gets today — so applying this migration changes no existing
-- training job's behaviour. What changes is that a dataset which HAS been classified can
-- now refuse.

ALTER TABLE ide_datasets
  -- ColumnClassification[] — {column, classification, pii, confidence, reason, masked}.
  ADD COLUMN IF NOT EXISTS classifications jsonb,
  -- DatasetUsePolicy — {purpose, lawfulBasis, retentionDays, collectedAt, permittedUses}.
  ADD COLUMN IF NOT EXISTS use_policy jsonb,
  -- LINEAGE. The canvas object and session the corpus was promoted from, so a refusal can
  -- name the card a person has to go and fix rather than an opaque dataset id. Plain text
  -- and no FK: `creation_sessions` holds the object inside a serialised graph, so there is
  -- no row to reference, and a guest board has no session at all.
  ADD COLUMN IF NOT EXISTS source_session_id text,
  ADD COLUMN IF NOT EXISTS source_object_id text;

-- "Which corpora in this workspace carry personal data" — the question a privacy review
-- asks, and the one that would otherwise scan every row's document. Partial, because the
-- rows that matter are the classified ones and they are the minority.
CREATE INDEX IF NOT EXISTS idx_ide_datasets_classified
  ON ide_datasets (project_id)
  WHERE classifications IS NOT NULL;
