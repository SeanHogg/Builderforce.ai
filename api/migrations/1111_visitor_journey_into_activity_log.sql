-- 1111 · The visitor journey is not its own table. It never was.
--
-- 1109 renamed `demo_events` to `visitor_events` and made it site-wide, which was
-- the right change to the DATA and left the wrong table standing. Three guards
-- said so independently the moment it landed:
--
--   • `check:shape-lint`   — its columns are `activity_log`'s columns.
--   • `check:tenant-column`— it has no tenant column, and needed an exemption.
--   • `check:swept-tables` — it needed its own autovacuum tuning, like every
--                            other append-only stream the platform keeps.
--
-- The consolidated data model had already answered it: `demo_events` maps onto
-- the `event_log` primitive in `source-to-target.tsv`, the same primitive that
-- absorbed `activity_events`, `admin_audit_log`, `deployment_events` and the rest.
-- A visitor is an ACTOR; where they went is a verb with a target and a time. The
-- separate table was drift, not design, so this folds it in and drops it.
--
-- `activity_log.tenant_id` is already documented as nullable "ONLY for
-- platform-global events (e.g. a pre-tenant login/registration)" — somebody who
-- has not chosen a workspace is exactly that, and the null is what keeps these
-- rows out of every tenant-scoped read.
--
-- The mapping (also stated once in `application/marketing/visitorActivity.ts`):
--
--   actor_type   'visitor'
--   actor_ref    visitor_id
--   verb         'visitor.' || kind
--   target_type  'visit'
--   target_id    visit_id
--   target_label path
--   metadata     metadata, with `persona` folded in
--
-- `persona` loses its column deliberately. It had one writer (the persona demo)
-- and no reader that grouped by it, so it is a fact about an event rather than a
-- dimension — and a column that is null for every non-demo row is exactly what
-- putting it on the platform's audit table would mean.

-- ── Carry the history across ────────────────────────────────────────────────
-- Idempotent by guard rather than by key: the source table is dropped at the end
-- of this file, so a re-run finds nothing to copy. `occurred_at` is preserved so
-- a journey keeps its real shape; `created_at` defaults to now, which is the
-- honest answer for a row that was written here today.
DO $$
BEGIN
  IF to_regclass('public.visitor_events') IS NOT NULL THEN
    INSERT INTO activity_log (tenant_id, actor_type, actor_ref, actor_name,
                              verb, target_type, target_id, target_label,
                              metadata, occurred_at)
    SELECT NULL,
           'visitor',
           v.visitor_id,
           'Visitor',
           left('visitor.' || v.kind, 64),
           'visit',
           v.visit_id,
           v.path,
           CASE
             WHEN v.persona IS NULL THEN v.metadata
             ELSE coalesce(v.metadata, '{}'::jsonb) || jsonb_build_object('persona', v.persona)
           END,
           v.occurred_at
    FROM visitor_events v;
  END IF;
END $$;

-- ── The one index the fold needs ────────────────────────────────────────────
-- The per-visitor timeline and the per-visit walk are both served by the
-- existing `idx_activity_log_actor (tenant_id, actor_type, actor_ref, occurred_at)`
-- and `idx_activity_log_target (tenant_id, target_type, target_id)`.
--
-- The flow-graph scan is the one that is not: "every visitor event in the last N
-- days" leads with time and cannot use a tenant-leading index, because these rows
-- share their null tenant with every other platform-global event. Partial, so it
-- indexes the visitor rows and nothing else.
CREATE INDEX IF NOT EXISTS idx_activity_log_visitor_time
  ON activity_log (occurred_at)
  WHERE actor_type = 'visitor';

-- ── Retire the table ────────────────────────────────────────────────────────
-- Its indexes and sequence go with it. `marketing_session_prompts.visit_id` stays:
-- a typed prompt is content, not an event, and it still joins to the journey by
-- that token — now against `activity_log.target_id`.
DROP TABLE IF EXISTS visitor_events;
