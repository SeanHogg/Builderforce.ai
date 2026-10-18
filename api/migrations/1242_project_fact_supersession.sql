-- 1242_project_fact_supersession.sql
-- Retire the facts the codebase has contradicted (project memory quality).
--
-- WHY. `project_facts` had no anchor, no content hash and no supersession edge, so
-- two failures were possible and both were live:
--   1. a fact the code later contradicted stayed live forever and was replayed on
--      every recall — update == replace only covers the SAME key, so a second belief
--      about the same subject under a different key simply accumulated;
--   2. `importance` was never written by any caller, so it sat at its column
--      default 0.5 on every row and recall's `ORDER BY importance DESC` degenerated
--      into newest-first.
--
-- The three provenance/ranking columns below (`importance`, `origin_execution_id`,
-- `origin_model`) are NOT new — 0276 and 0371/1228 created them and the Drizzle
-- schema already declares them. They are re-declared with IF NOT EXISTS so this
-- migration is self-contained on a database where those tracks did not land, and
-- so the column set the guard in `check-migrations.mjs` unions is complete from
-- this file alone. Genuinely new here: `file_anchors`, `content_hash`,
-- `superseded_by`.
--
-- `superseded_by` is a BIGINT ORDINAL, not a row pointer: it records THAT a fact
-- was retired, and in what order, so two live facts can never both claim to be
-- current. It is deliberately not a foreign key — a fact's lineage must survive
-- the deletion of whatever corrected it. Rows are retired, never deleted, so this
-- is a soft edge and 0 is reserved as the "retired, supersession unknown" sentinel.
--
-- Idempotent: every statement is IF NOT EXISTS, and all three backfills select only
-- rows that are still live and still unranked, so a second run changes nothing.

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS file_anchors JSONB;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS superseded_by BIGINT;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_execution_id INTEGER;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_model VARCHAR(200);
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS importance REAL NOT NULL DEFAULT 0.5;

COMMENT ON COLUMN project_facts.file_anchors IS 'Files this fact was read out of, as {path,line} objects. A fact whose anchor no longer holds the claim it makes is the signal to retire it.';
COMMENT ON COLUMN project_facts.content_hash IS 'sha256 over the normalized content (lower-cased, whitespace-collapsed), written by the application on every save. Left NULL on rows written before this migration; they acquire one on their next write.';
COMMENT ON COLUMN project_facts.superseded_by IS '0 = retired by the 1242 data fix (the superseding belief is not in the database). Non-zero = the ordinal of the row that replaced this fact. NULL = live. Recall excludes non-NULL rows.';

-- Partial index: recall reads only live rows, and a partial index keeps the retired
-- history out of the index rather than making every recall scan past it.
CREATE INDEX IF NOT EXISTS idx_project_facts_live
  ON project_facts (tenant_id, project_id)
  WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------
-- BACKFILL 1 — rank the facts that were written without one.
--
-- Every one of the 591 rows predated this migration at importance 0.5, so the
-- recall ordering was `importance DESC, updated_at DESC` = plain newest-first. The
-- tiers below are the same weights the write path uses (application/llm/
-- projectFacts.ts, `factImportance`), so a row scored here and a row scored by a
-- live write sit on ONE scale instead of two.
--
-- Tiered by what the fact CLAIMS, which is a property of its text and so is stable
-- forever — re-running this cannot move a row off its tier.
-- ---------------------------------------------------------------------------
UPDATE project_facts SET importance = 0.85 WHERE importance = 0.5 AND source <> 'qa-cache' AND content ~* '(invariant|must always|by design|architecture|contract)';
UPDATE project_facts SET importance = 0.70 WHERE importance = 0.5 AND source <> 'qa-cache' AND content ~* '(convention|we use|deploy|lint|lives? in|located|version|repo|path)';
UPDATE project_facts SET importance = 0.60 WHERE importance = 0.5 AND source <> 'qa-cache' AND content ~* '(decision|decided|chose|agreed|rationale|because)';

-- ---------------------------------------------------------------------------
-- BACKFILL 2 — retire the two known-bad rows.
--
-- The exact row ids are NOT hardcoded, deliberately. Both rows exist only in the
-- live database — their content and key are not in the repository: a grep for
-- "diagnostics-host-engine-stamps" or "qa:v2:c3a984d3" returns nothing outside this
-- file. `project_facts.id` is a uuid and there is no way to derive the intended
-- row's id from its text, so an id hardcoded here would be a guess that silently
-- no-ops on any database where the numbering differs. Both rows are therefore
-- SELECTED BY TEXT PATTERN, which is also what makes the fix idempotent.
--
-- (1) The fact claiming an "8/16 step cap". Matched on CONTENT, not on its key
--     (`diagnostics-host-engine-stamps`): that key is a topic name a CORRECTED fact
--     would legitimately re-use, and retiring by key would delete the corrected
--     belief's home as well.
--
--     The `step cap` AND-clause is the load-bearing part: it requires the words
--     "step cap" AND a `8 / 16` ratio in the same row, so neither half alone is
--     enough to retire a row. The whitespace-tolerant `\s*` covers "8/16", "8 / 16"
--     and "8 /16" without matching an unrelated "816".
-- ---------------------------------------------------------------------------
UPDATE project_facts
   SET superseded_by = 0
 WHERE superseded_by IS NULL
   AND content ILIKE '%step cap%'
   AND content ~* '8\s*/\s*16';

-- (2) The cached answer `qa:v2:c3a984d3`, which replays that same wrong claim
--     verbatim on an exact-repeat question and therefore outlives any fix to the
--     fact above. Matched by key OR (qa-cache row AND the same content pattern), so
--     the fix lands even if the question text was re-normalized into a different
--     hash after the row was written.
--
--     Neutralized rather than deleted: the row stays as the audit record of what was
--     served, and `superseded_by IS NOT NULL` takes it out of the exact-key lookup
--     (projectMemory) and the ANN arm (memorySemanticRecall), both of which now
--     filter on it. `origin_execution_id` is set to 0 — a value no real run has — so
--     the row reads as deliberately unserviceable rather than as a null that could
--     be mistaken for "provenance unknown, fine to replay".
UPDATE project_facts
   SET superseded_by = 0,
       origin_execution_id = 0
 WHERE superseded_by IS NULL
   AND (
        key = 'qa:v2:c3a984d3'
     OR (source = 'qa-cache' AND content ILIKE '%step cap%' AND content ~* '8\s*/\s*16')
   );