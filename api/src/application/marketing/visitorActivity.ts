/**
 * THE ANONYMOUS VISITOR JOURNEY, STORED IN `activity_log`.
 *
 * ── WHY THERE IS NO `visitor_events` TABLE ───────────────────────────────────
 * There was one, briefly. It began as `demo_events` and migration 1109 renamed
 * it, which is when it became obvious that it was a second copy of a shape the
 * platform already owns: an actor, a verb, a target, a time, some metadata.
 * The consolidated data model had already said so — `demo_events` maps onto the
 * `event_log` primitive in the source-to-target map, the same primitive that
 * absorbed `activity_events`, `admin_audit_log` and eighteen other streams — and
 * the table's continued existence was the drift, not the plan. Three separate
 * guards said the same thing from three angles: its shape matched `activity_log`,
 * it carried no tenant column, and it needed its own autovacuum tuning. Migration
 * 1111 folds it in and drops it.
 *
 * ── AN ANONYMOUS VISITOR IS AN ACTOR, NOT A SPECIAL CASE ─────────────────────
 * `activity_log.tenant_id` is documented as nullable "ONLY for platform-global
 * events (e.g. a pre-tenant login/registration)" — a person who has not yet
 * chosen a workspace is exactly that, and the null is what keeps their rows
 * invisible to every tenant-scoped read (`queryActivityLog` filters on an
 * equality, so a global row simply never matches one).
 *
 * The column mapping, once, here:
 *
 *   actor_type   'visitor'                  the new member of the actor union
 *   actor_ref    the opaque visitor id      → `idx_activity_log_actor` answers "one visitor's journey"
 *   verb         'visitor.' + kind          namespaced so a journey kind cannot collide with a mutation verb
 *   target_type  'visit'                    a contiguous run of activity is the thing an event belongs to
 *   target_id    the visit id               → `idx_activity_log_target` answers "one visit"
 *   target_label the normalised path        both columns cap at 300; nothing is lost
 *   metadata     the event's own bag + persona
 *
 * `persona` was a column of its own and had no reader outside the demo seeder —
 * it is a fact ABOUT an event, not a dimension anything grouped by, so it rides
 * in metadata rather than earning a column on the platform's audit table.
 *
 * ── RETENTION IS ROW-LEVEL, NOT TABLE-LEVEL ──────────────────────────────────
 * `SWEPT_TABLES` is explicit that membership is the permission and that it holds
 * only relations with "no business records". `activity_log` is the audit trail;
 * it must never be swept wholesale. So the 90-day visitor window follows the
 * lapsed-memory precedent that registry names: a policy on the ROW, run from
 * `runRetentionPurge` and never a vacuum rewrite. See {@link purgeVisitorActivity}.
 */

import { eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import type { VisitorEvent } from '../../domain/marketing/VisitorJourney';
import { type ActivityInput, type ActorIdentity, recordActivityBatch } from '../activity/activityLog';

/** The actor union member. Exported so a read predicate cannot spell it differently. */
export const VISITOR_ACTOR_TYPE = 'visitor';
/** Namespace for a journey kind inside the shared verb vocabulary. */
export const VISITOR_VERB_PREFIX = 'visitor.';
/** A contiguous run of activity — what an event targets. */
export const VISIT_TARGET_TYPE = 'visit';

/**
 * How long a visitor's journey is kept.
 *
 * The window the table carried before it was folded in, unchanged: the flow
 * graph never looks back further than 30 days, and 90 leaves room to answer a
 * question about last quarter's funnel before the evidence is gone.
 */
export const VISITOR_RETENTION_DAYS = 90;

/**
 * The display label on an anonymous row.
 *
 * Not localisable, and deliberately: `actor_name` is a denormalised label frozen
 * at write time (the platform's own rows say 'System'), and these rows are read
 * by the superadmin console and the flow graph, both of which render the visitor
 * id rather than this. A translated word stored in a column would be the wrong
 * word for every other reader.
 */
const VISITOR_ACTOR_NAME = 'Visitor';

/** Anyone who has not identified themselves. `ref` is the browser-minted id — an
 *  opaque token, not a key into any table, which is the whole point of it. */
export function visitorActor(visitorId: string): ActorIdentity {
  return { type: 'visitor', ref: visitorId, name: VISITOR_ACTOR_NAME };
}

/** `page_view` → `visitor.page_view`. */
export function visitorVerb(kind: string): string {
  return `${VISITOR_VERB_PREFIX}${kind}`;
}

/** The inverse, applied at every read boundary so the domain keeps seeing the
 *  bare kind it reasons about (`visitorFlowGraph` switches on `page_view`, not
 *  on the storage spelling). A row without the prefix is returned as-is. */
export function kindFromVerb(verb: string): string {
  return verb.startsWith(VISITOR_VERB_PREFIX) ? verb.slice(VISITOR_VERB_PREFIX.length) : verb;
}

/** The `WHERE` every visitor read shares, as raw SQL for the aggregate queries
 *  that cannot use the Drizzle builder. One spelling of the predicate. */
export const visitorRowsSql = sql`actor_type = ${VISITOR_ACTOR_TYPE} AND tenant_id IS NULL`;

/** One validated journey event, as an activity row. */
export function toActivityInput(event: VisitorEvent): ActivityInput {
  return {
    tenantId: null,
    actor: visitorActor(event.visitorId),
    verb: visitorVerb(event.kind),
    targetType: VISIT_TARGET_TYPE,
    targetId: event.visitId,
    targetLabel: event.path,
    metadata: event.persona ? { ...(event.metadata ?? {}), persona: event.persona } : event.metadata,
    occurredAt: event.occurredAt,
  };
}

/**
 * Persist a batch of journey events. Best-effort by contract — this is telemetry
 * attached to a visitor's real work, and a failed append must never fail their
 * request.
 */
export async function recordVisitorActivity(env: Env | undefined, db: Db, events: VisitorEvent[]): Promise<void> {
  await recordActivityBatch(env, db, events.map(toActivityInput));
}

/**
 * Erase one visitor's journey — the privacy path.
 *
 * Cross-tenant by construction (these rows have no tenant), and declared as
 * `subject_own_rows`: the subject of the data is the visitor id in `actor_ref`,
 * and it is the only thing this deletes.
 */
export async function forgetVisitorActivity(db: Db, visitorId: string): Promise<number> {
  const removed = await db
    .delete(activityLog)
    .where(acrossTenants(activityLog, 'subject_own_rows',
      eq(activityLog.actorType, VISITOR_ACTOR_TYPE),
      eq(activityLog.actorRef, visitorId),
    ))
    .returning({ id: activityLog.id });
  return removed.length;
}

/**
 * Drop journey rows past the retention window.
 *
 * A row-level policy rather than a `SWEPT_TABLES` entry, because the table it
 * lives in is the audit trail: the predicate names the visitor rows and touches
 * nothing else, and the relation is never vacuum-rewritten on their account.
 */
export async function purgeVisitorActivity(db: Db, cutoff: Date): Promise<unknown> {
  return db
    .delete(activityLog)
    .where(acrossTenants(activityLog, 'scheduled_sweep',
      eq(activityLog.actorType, VISITOR_ACTOR_TYPE),
      lt(activityLog.occurredAt, cutoff),
    ));
}
