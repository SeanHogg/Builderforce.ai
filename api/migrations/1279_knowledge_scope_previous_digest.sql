-- 1279 · The stored baseline for the knowledge graph's Compare lens (PRD 38 §3, §4.8).
--
-- `knowledge_scopes.previous_digest` is the review digest the root had BEFORE its last
-- one: when `writeKnowledge` records a new `last_digest`, the old one moves here. Compare
-- builds "before" with `GET …/knowledge-graph?root=&at=<previous_digest>`, from the
-- immutable review snapshot `knowledge/{t}/{p}/{root}/reviews/{digest}.json` (R2, written
-- once per digest) — so every host compares against the same stored review, not against
-- whatever one session happened to see.
--
-- NULL for a root reviewed once, and for every row written before this.
--
-- Expand only: one nullable column, no default, no backfill. Idempotent / re-runnable.

ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS previous_digest varchar(64);
