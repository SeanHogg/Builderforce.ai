-- 1248_project_fact_recall_decay.sql
--
-- WHY. Ticket 5301. `project_facts` could name a file (1242) but not the hash of
-- that file, and it had no record of whether a fact had ever been recalled. A
-- belief about a file that has since changed kept riding the run-start block,
-- and a fact nobody had read in a month was indistinguishable from one read
-- this turn. Decay could not run without inventing a timestamp.
--
-- `file_anchors` stays JSONB. The shape gains an optional `contentHash` per
-- anchor (`{path, line?, contentHash?}`). That is a value change, not a type
-- change, so there is no ALTER of the column — only the comment, so the next
-- reader does not treat 1242's `{path, line}` description as the contract.
--
-- `last_recalled_at` is null until a recall actually returns the fact. It is
-- not a proxy for `updated_at`: a rewrite is not a recall, and a recall must
-- not look like a rewrite. `recall_count` is how often that happened, so
-- ranking can prefer a belief the project keeps using over one it wrote once
-- and never opened again.
--
-- DOWN. Drop the two columns and the index. The jsonb comment reverts to the
-- 1242 wording; the stored anchors are unchanged.

ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS last_recalled_at TIMESTAMP;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS recall_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_facts.file_anchors IS
  'Files this fact is about: [{path, line?, contentHash?}]. contentHash is the file hash at write time; recall treats a changed hash as stale. Null = unanchored.';
COMMENT ON COLUMN project_facts.last_recalled_at IS
  'When a run last returned this fact from recall. Null = never recalled. Not updated_at.';
COMMENT ON COLUMN project_facts.recall_count IS
  'How many times recall has returned this fact. 0 = never.';

CREATE INDEX IF NOT EXISTS project_facts_unrecalled_idx
  ON project_facts (tenant_id, project_id, created_at)
  WHERE last_recalled_at IS NULL AND superseded_by IS NULL;
