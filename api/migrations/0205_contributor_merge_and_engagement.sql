-- 0205_contributor_merge_and_engagement.sql
--
-- Lets a tenant CONSOLIDATE duplicate contributor profiles created when activity
-- ingestion can't auto-link the same person across sources (a GitHub login vs a
-- Jira account id vs a Builderforce user). Ingestion already supports many
-- identities → one contributor (contributor_identities), but there was no way to
-- *merge* two contributor rows once duplicates exist. This adds the merge
-- primitive, tenant-wide and reversible:
--
--   contributors.merged_into_id      — tombstone pointer. A merged-away (loser)
--     contributor is kept (not deleted) with is_active=false and this set to the
--     survivor, so history and the merge log stay intact and an un-merge can undo.
--
--   activity_events.merged_from_contributor_id — reversibility marker. On merge we
--     re-point a loser's events to the survivor and stamp the loser id here, so an
--     un-merge can move exactly those rows back set-based (no need to log every
--     event id). Daily metrics are DERIVED from activity_events, so they're simply
--     recomputed for the affected contributors rather than hand-merged.
--
--   contributor_merges — the audit + undo record. One row per merge, carrying a
--     JSONB snapshot of the small things that don't have a column marker (the
--     moved/deduped identities, team memberships, prior survivor user link).
--
-- The merge "applies across all projects in the tenant" because activity_events /
-- identities / metrics / dev-team memberships are tenant-scoped (not project) — a
-- single re-point covers every project and segment at once.
--
-- Engagement (slice 3) reads existing signal tables (activity_events,
-- audit_events, vscode_connections) joined to the survivor via contributors.user_id
-- — no new ingest table needed — so only an index assist is added here.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS.

-- ── contributors: tombstone pointer for a merged-away profile ─────────────────
ALTER TABLE contributors
  ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES contributors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contributors_merged_into ON contributors(merged_into_id);

-- ── activity_events: which (now-merged) contributor a row was re-pointed FROM ──
ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS merged_from_contributor_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_activity_events_merged_from
  ON activity_events(merged_from_contributor_id) WHERE merged_from_contributor_id IS NOT NULL;

-- engagement read assist: activity by contributor in a time window.
CREATE INDEX IF NOT EXISTS idx_activity_events_contrib_occurred
  ON activity_events(tenant_id, contributor_id, occurred_at);
-- engagement read assist: platform actions / vscode presence by user in a window.
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_user_created
  ON audit_events(tenant_id, user_id, created_at);

-- ── contributor_merges (audit + undo log) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS contributor_merges (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id             UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- survivor (kept) and loser (tombstoned). FKs SET NULL so a later hard-delete of
  -- either contributor doesn't orphan the log row.
  target_contributor_id  INTEGER REFERENCES contributors(id) ON DELETE SET NULL,
  source_contributor_id  INTEGER REFERENCES contributors(id) ON DELETE SET NULL,
  -- counts surfaced in the UI + sanity for the undo.
  moved_activity_count   INTEGER NOT NULL DEFAULT 0,
  moved_identity_count   INTEGER NOT NULL DEFAULT 0,
  -- JSONB undo payload: source contributor snapshot, moved/deduped identity rows,
  -- moved/skipped team memberships, prior survivor user_id (for link rollback).
  undo_payload           JSONB,
  status                 VARCHAR(16) NOT NULL DEFAULT 'merged', -- 'merged' | 'reverted'
  merged_by_user_id      VARCHAR(36),
  merged_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  reverted_at            TIMESTAMP
);

DROP TRIGGER IF EXISTS trg_contributor_merges_segment ON contributor_merges;
CREATE TRIGGER trg_contributor_merges_segment BEFORE INSERT ON contributor_merges FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
UPDATE contributor_merges x SET segment_id = s.id FROM segments s WHERE s.tenant_id = x.tenant_id AND s.is_default AND x.segment_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_contributor_merges_tenant ON contributor_merges(tenant_id, merged_at);
CREATE INDEX IF NOT EXISTS idx_contributor_merges_target ON contributor_merges(target_contributor_id);
