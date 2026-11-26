-- 1367 · The commit a root's stored review ran at (Compare's "before" source at a revision, PRD 43 C8).
--
-- `knowledge_scopes.commit_sha` is the git HEAD of the reviewed folder at the moment the review at `last_digest` completed,
-- recorded by the editor only when the working tree was clean then, and sent beside the pack (`?commitSha=`, 7-64 hex). `previous_commit_sha` is the
-- same for `previous_digest` (Compare's stored baseline): when a NEW digest is recorded the old value moves there with it,
-- exactly as `previous_digest` and `previous_extractor_version` do (1279, 1343). The editor's Compare reads the baseline's
-- source at `previous_commit_sha` so the code pane shows the file as the previous review saw it.
--
-- NULL for every row written before this, for a folder that is not a git repository, and for a client that sent none: an
-- unknown, which the editor reads as "the old source is not available", never as the working copy.
--
-- Expand only: two nullable columns, no default, no backfill. The old Worker's INSERT/UPDATE of knowledge_scopes names
-- neither, so it is unaffected while the deploy completes. Idempotent / re-runnable.
SET LOCAL lock_timeout = '3s';

ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS commit_sha varchar(64);
ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS previous_commit_sha varchar(64);
