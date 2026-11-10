-- 1343 · What a root's stored review was measured with (PRD 41 §C9 comparability).
--
-- `knowledge_scopes.extractor_version` / `tool_versions` record the extractor version and the analyzer versions
-- (`{ "<tool>": "<version>" }`) of the review at `last_digest`, as the uploading client states them with the pack
-- that records that digest. `previous_extractor_version` / `previous_tool_versions` are the same for
-- `previous_digest` (Compare's stored baseline): when a NEW digest is recorded, the old values move there with it,
-- exactly as `previous_digest` does (1279). The VS Code baseline compares them with its own through memory's
-- `comparable()`, so a platform review from another extractor or analyzer version is not comparable.
--
-- NULL for every row written before this and for every review whose client stated none: an unknown, which the
-- comparison never reads as equal.
--
-- Expand only: four nullable columns, no default, no backfill. The old Worker's INSERT/UPDATE of knowledge_scopes
-- names none of them, so it is unaffected while the deploy completes. Idempotent / re-runnable.
SET LOCAL lock_timeout = '3s';

ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS extractor_version varchar(64);
ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS tool_versions jsonb;
ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS previous_extractor_version varchar(64);
ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS previous_tool_versions jsonb;
