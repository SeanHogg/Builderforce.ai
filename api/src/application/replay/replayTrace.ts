/**
 * Insights TRACE VERBS — the buyer's path, written as activity (PRD 33 §3.3, §4.2, §11).
 *
 * Every step a workspace takes from "found the listing" to "watched a recording"
 * leaves ONE `activity_log` row through here, so the runbook (§11) and the set-up
 * page's Verify checks (§4.2 step 6) read one vocabulary instead of five ad-hoc
 * verbs. Rows are tenant-scoped and target the capability itself
 * (`target_type = 'capability'`, `target_id = 'session-replay'`); a site-specific
 * step carries `metadata.siteId`.
 *
 * Best-effort like every activity write: a trace failure never fails the step it
 * describes (`recordActivity` swallows and reports).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import {
  activityDatabase,
  recordActivity,
  resolveHumanActor,
  SYSTEM_ACTOR,
  type ActorIdentity,
} from '../activity/activityLog';
import { SESSION_REPLAY_SLUG } from '../commerce/replayCatalog';

export const REPLAY_TRACE_TARGET_TYPE = 'capability';
export const REPLAY_TRACE_TARGET_ID = SESSION_REPLAY_SLUG;

/** Every verb the buyer's path writes, in the order a workspace meets them. */
export const REPLAY_TRACE_VERBS = {
  checkoutStarted: 'replay.checkout.started',
  checkoutSessionCreated: 'replay.checkout.session_created',
  paymentCompleted: 'replay.payment.completed',
  entitlementGranted: 'replay.entitlement.granted',
  creditsAdded: 'replay.credits.added',
  siteKeyIssued: 'replay.site_key.issued',
  loaderHit: 'replay.loader.hit',
  ingestFirstEvent: 'replay.ingest.first_event',
  creditsFirstDebit: 'replay.credits.first_debit',
  sessionViewed: 'replay.session.viewed',
  paymentRefunded: 'replay.payment.refunded',
  allowanceExhausted: 'replay.allowance.exhausted',
  releaseRenamed: 'replay.release.renamed',
  summaryGenerated: 'replay.summary.generated',
  // S4e: every prescription action a person takes (`prescriptionActions.ts`).
  prescriptionFix: 'replay.prescription.fix',
  prescriptionTest: 'replay.prescription.test',
  prescriptionStartTest: 'replay.prescription.start-test',
  prescriptionFollowUp: 'replay.prescription.follow-up',
  prescriptionTicket: 'replay.prescription.ticket',
  prescriptionDismiss: 'replay.prescription.dismiss',
  prescriptionPublishPreview: 'replay.prescription.publish-preview',
  prescriptionRevert: 'replay.prescription.revert',
} as const;

export type ReplayTraceVerb = (typeof REPLAY_TRACE_VERBS)[keyof typeof REPLAY_TRACE_VERBS];

export interface ReplayTraceInput {
  tenantId: number;
  verb: ReplayTraceVerb;
  /** Set for a site-specific step (key issued, loader hit, first event, …). */
  siteId?: string | null;
  /** The member who acted; omitted for system steps (webhooks, ingest). */
  actorId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function actorFor(env: Env | undefined, db: Db, tenantId: number, actorId?: string | null): Promise<ActorIdentity> {
  if (!actorId) return SYSTEM_ACTOR;
  try {
    return await resolveHumanActor(env, db, tenantId, actorId);
  } catch {
    // The trace still lands, attributed by id: a name lookup is not worth losing the step.
    return { type: 'human', ref: actorId, name: actorId };
  }
}

/** Write one trace row. Never throws. */
export async function recordReplayTrace(env: Env | undefined, db: Db, input: ReplayTraceInput): Promise<void> {
  const actor = await actorFor(env, db, input.tenantId, input.actorId);
  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor,
    verb: input.verb,
    targetType: REPLAY_TRACE_TARGET_TYPE,
    targetId: REPLAY_TRACE_TARGET_ID,
    targetLabel: 'Insights',
    summary: input.summary ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.siteId ? { siteId: input.siteId } : {}),
    },
  });
}

/**
 * The trace a capability licence grant writes. Called from the ONE licence writer
 * (`listingCommerce.grantListing`) for every grant; a no-op for anything but the
 * Insights listing, so the hook does not need to know which slugs trace.
 */
export async function traceCapabilityGranted(
  env: Env | undefined,
  db: Db,
  input: { tenantId: number; slug: string; actorId: string | null; licenceId: number },
): Promise<void> {
  if (input.slug !== SESSION_REPLAY_SLUG) return;
  await recordReplayTrace(env, db, {
    tenantId: input.tenantId,
    verb: REPLAY_TRACE_VERBS.entitlementGranted,
    actorId: input.actorId,
    summary: 'Installed Insights',
    metadata: { licenceId: input.licenceId },
  });
}

const firstTraceKey = (tenantId: number, siteId: string, verb: string) =>
  `replay:trace:first:t:${tenantId}:${siteId}:${verb}`;

/**
 * When `verb` was first written for this site, or null when it never was.
 *
 * Only a found timestamp is cached (it can never change); "not yet" is re-read,
 * because the Verify panel polls exactly so it can see the moment it happens.
 */
export async function firstTraceAt(
  env: Env | undefined,
  db: Db,
  input: { tenantId: number; siteId: string; verb: ReplayTraceVerb },
): Promise<Date | null> {
  const key = firstTraceKey(input.tenantId, input.siteId, input.verb);
  const cached = await peekCached<string>(env, key);
  if (cached) return new Date(cached);

  const [row] = await activityDatabase(env, db)
    .select({ occurredAt: activityLog.occurredAt })
    .from(activityLog)
    .where(scopedToTenant(
      activityLog,
      input.tenantId,
      and(
        eq(activityLog.targetType, REPLAY_TRACE_TARGET_TYPE),
        eq(activityLog.targetId, REPLAY_TRACE_TARGET_ID),
        eq(activityLog.verb, input.verb),
        sql`${activityLog.metadata}->>'siteId' = ${input.siteId}`,
      ),
    ))
    .orderBy(asc(activityLog.occurredAt))
    .limit(1);
  if (!row) return null;
  const at = row.occurredAt instanceof Date ? row.occurredAt : new Date(String(row.occurredAt));
  await setCached(env, key, at.toISOString(), { kvTtlSeconds: 30 * 24 * 60 * 60 });
  return at;
}
