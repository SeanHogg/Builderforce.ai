-- 1111 · Fold the visitor journey into `activity_log`, and drop its table.
--
-- 1109 renamed `demo_events` to `visitor_events` because the stream had stopped
-- being demo-only. Renaming it is what made the real problem legible: it was a
-- second copy of a shape the kernel already owns — an actor, a verb, a target, a
-- time, some metadata — and the consolidated data model had already mapped
-- `demo_events` onto the `event_log` primitive that absorbed `activity_events`,
-- `admin_audit_log` and eighteen other streams. The table's continued existence
-- was the drift, not the plan.
--
-- Three guards said the same thing from three angles and each was answerable
-- with an adjudication: its shape matched `activity_log`, it carried no tenant
-- column, it needed its own autovacuum tuning. Three arguments for one table is
-- the signal that the table is the thing being argued for.
--
-- An anonymous visitor is an ACTOR, not a special case. `activity_log.tenant_id`
-- is already documented as nullable for platform-global, pre-tenant events, and
-- every tenant-scoped read filters on an equality — so a visitor's rows are
-- invisible to every workspace by construction rather than by a predicate
-- somebody has to remember. `actor_type = 'visitor'` joins the union.
--
-- The column mapping lives in `application/marketing/visitorActivity.ts`; this
-- migration applies it once to the rows that already exist, then drops the table.

INSERT INTO activity_log (
  tenant_id, actor_type, actor_ref, actor_name,
  verb, target_type, target_id, target_label,
  metadata, occurred_at, created_at
)
SELECT
  NULL,
  'visitor',
  visitor_id,
  'Visitor',
  -- `visitor_events.kind` was varchar(64) and `activity_log.verb` is too, so the
  -- eight-character prefix can overflow it. The domain now caps a kind at 56
  -- (`VisitorJourney.ts`) for exactly this reason; the truncation is here for the
  -- rows written before that cap existed.
  left('visitor.' || kind, 64),
  'visit',
  visit_id,
  path,
  -- `persona` was a column and had no reader outside the demo seeder: a fact
  -- ABOUT an event, not a dimension anything grouped by. It rides in metadata
  -- rather than earning a column on the platform's audit table.
  CASE
    WHEN persona IS NOT NULL
      THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('persona', persona)
    ELSE metadata
  END,
  occurred_at,
  created_at
FROM visitor_events;

-- ── The one index the fold needs ────────────────────────────────────────────
-- The per-visitor timeline and the per-visit walk are both already served:
-- `idx_activity_log_actor (tenant_id, actor_type, actor_ref, occurred_at)` and
-- `idx_activity_log_target (tenant_id, target_type, target_id)`.
--
-- The flow-graph scan is the one that is not. "Every visitor event in the last N
-- days" leads with time and cannot use a tenant-leading index, because these rows
-- share their null tenant with every other platform-global event — a login, a
-- registration, a broadcast. Partial, so it covers the visitor rows and nothing
-- else, and mirrors `idx_activity_log_visitor_time` on the Drizzle table.
CREATE INDEX IF NOT EXISTS idx_activity_log_visitor_time
  ON activity_log (occurred_at)
  WHERE actor_type = 'visitor';

-- Retention becomes a ROW-level policy (`purgeVisitorActivity`, wired into
-- `runRetentionPurge`) rather than a `SWEPT_TABLES` entry, because the relation
-- these rows now live in is the audit trail and must never be swept wholesale.
-- The 90-day window is unchanged.
DROP TABLE visitor_events;
