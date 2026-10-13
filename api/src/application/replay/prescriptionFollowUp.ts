/**
 * "Follow up" on a sales finding (PRD 33 §5.1.4): the identifiable visitors who
 * hesitated, resolved to the workspace's contacts by THE resolver
 * (`resolveKnownContacts`), enrolled — by a person, after seeing who and what —
 * into a `sequence` canvas object. Insights never sends: every message goes out
 * through the cadence runner (`sales/sequenceRunner.runSequenceSweep`), which owns
 * the send policy (mailbox, retry vs stop, stop-on-reply). Unmatched visitors are
 * counted, never listed.
 *
 * For Builderforce's own site the "platform" path is the existing broadcast
 * composer: a superadmin gets the matched `sales_leads` ids to prefill it.
 *
 * Verified after {@link FOLLOW_UP_WINDOW_DAYS}: enrolled contacts' conversion vs
 * matched contacts nobody enrolled.
 */

import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { readSequenceEnrolments, type SequenceEnrolment } from '@builderforce/creation-canvas-contract';
import type { ReplayFollowUpPreviewDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, creationSessions, replayRecordings, salesLeads } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { asJsonRecord } from '../../domain/shared/json';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { DAY_MS } from '../../domain/shared/time';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { replayTelemetryDb } from './replayDatabase';
import { resolveKnownContacts } from './resolveKnownContacts';
import type { PrescriptionRow } from './prescriptionReads';

/** Days after enrolment before a follow-up is judged. */
export const FOLLOW_UP_WINDOW_DAYS = 14;
const COHORT_WINDOW_DAYS = 30;
const COHORT_MAX_VISITORS = 500;
const LEADS_MAX = 200;

const evidenceIds = (row: Pick<PrescriptionRow, 'finding'>): string[] => {
  const evidence = asJsonRecord(row.finding).evidence;
  return Array.isArray(evidence) ? evidence.map((e) => String(asJsonRecord(e).recordingId ?? '')).filter(isUuid) : [];
};

/**
 * The identifiable visitors the finding is about: the cited recordings, plus every
 * identified, unconverted visit to the finding's page in the window.
 */
export async function cohortVisitorIds(env: Env | undefined, db: Db, scope: ReplayScope, row: Pick<PrescriptionRow, 'finding' | 'pagePath'>, now: Date): Promise<string[]> {
  const ids = evidenceIds(row);
  // Nothing to anchor on: never fall through to "every visitor of the site".
  if (ids.length === 0 && !row.pagePath) return [];
  const rows = await replayTelemetryDb(env, db)
    .select({ visitorId: replayRecordings.visitorId })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      or(
        ids.length > 0 ? inArray(replayRecordings.id, ids) : undefined,
        row.pagePath
          ? and(
            gte(replayRecordings.startedAt, new Date(now.getTime() - COHORT_WINDOW_DAYS * DAY_MS)),
            sql`${replayRecordings.routes} @> array[${row.pagePath}]::text[]`,
            eq(replayRecordings.converted, false),
            or(isNotNull(replayRecordings.identifiedId), sql`${replayRecordings.tags} ? 'user'`),
          )
          : undefined,
      ),
    ))
    .orderBy(desc(replayRecordings.startedAt))
    .limit(COHORT_MAX_VISITORS);
  return [...new Set(rows.map((r) => r.visitorId))];
}

/** A first touch the seller edits in the sequence before anything is sent. Never sent from here. */
function draftFor(row: Pick<PrescriptionRow, 'ruleId' | 'pagePath'>): ReplayFollowUpPreviewDto['draft'] {
  const where = row.pagePath ?? 'our site';
  return row.ruleId === 'checkout_abandon_known'
    ? { subject: 'Anything we can help with?', body: `Hi {{firstName}},\n\nI saw you started an order on ${where} and did not finish. If something got in the way, just reply and I will sort it out.` }
    : { subject: 'A question about pricing?', body: `Hi {{firstName}},\n\nI noticed you were looking at ${where}. If it would help to talk through which option fits, just reply here.` };
}

/** Builderforce's own leads among these visitors — superadmin only (the broadcast composer is theirs). */
async function platformLeadIds(env: Env, db: Db, actorId: string | null, visitorIds: string[]): Promise<string[]> {
  if (!actorId || visitorIds.length === 0 || !(await resolveIsSuperadmin(env, actorId))) return [];
  const rows = await db.select({ id: salesLeads.id }).from(salesLeads).where(inArray(salesLeads.visitorId, visitorIds)).limit(LEADS_MAX);
  return rows.map((r) => r.id);
}

/** Who WOULD be enrolled and with what, before a person decides. */
export async function previewFollowUp(
  env: Env,
  db: Db,
  scope: ReplayScope,
  row: PrescriptionRow,
  input: { actorId: string | null; now: Date; enrolled?: number },
): Promise<ReplayFollowUpPreviewDto> {
  const visitorIds = await cohortVisitorIds(env, db, scope, row, input.now);
  const known = await resolveKnownContacts(env, db, scope, visitorIds);
  return {
    matched: known.matched.map((c) => ({ contactId: c.contactId, name: c.name, email: c.email })),
    unmatched: known.unmatched,
    draft: draftFor(row),
    platformLeadIds: await platformLeadIds(env, db, input.actorId, visitorIds),
    enrolled: input.enrolled ?? 0,
  };
}

/** The `sequence` object, if it is this workspace's. */
async function loadSequence(db: Db, tenantId: number, objectId: string) {
  if (!isUuid(objectId)) throw new NotFoundError('Sequence', objectId);
  const [row] = await db
    .select({ id: creationSessionObjects.id, content: creationSessionObjects.content, sessionId: creationSessionObjects.sessionId })
    .from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(scopedToTenant(creationSessions, tenantId, eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.kind, 'sequence')))
    .limit(1);
  if (!row) throw new NotFoundError('Sequence', objectId);
  return row;
}

/**
 * Enrol matched contacts (all, or the chosen ones) into the sequence. Only a
 * contact `resolveKnownContacts` matched can be enrolled; a contact already in the
 * cadence is left as it is. Returns how many were added.
 */
export async function enrolFollowUp(
  env: Env,
  db: Db,
  scope: ReplayScope,
  row: PrescriptionRow,
  input: { sequenceObjectId: string; contactIds?: string[]; now: Date },
): Promise<number> {
  const sequence = await loadSequence(db, scope.tenantId, input.sequenceObjectId);
  const known = await resolveKnownContacts(env, db, scope, await cohortVisitorIds(env, db, scope, row, input.now));
  const chosen = input.contactIds && input.contactIds.length > 0
    ? known.matched.filter((c) => input.contactIds!.includes(c.contactId))
    : known.matched;
  const reachable = chosen.filter((c) => c.email);
  if (reachable.length === 0) throw new ValidationError('None of these visitors matches a contact with an email to follow up');

  const content = asJsonRecord(sequence.content);
  const current = readSequenceEnrolments(content.enrolments);
  const have = new Set(current.map((e) => e.contactRef.toLowerCase()));
  const nowISO = input.now.toISOString();
  const added: SequenceEnrolment[] = reachable
    .filter((c) => !have.has(c.email.toLowerCase()))
    .map((c) => ({ contactRef: c.email, name: c.name, enrolledAtISO: nowISO, stepsSent: 0, lastSentAtISO: '', repliedAtISO: '', stoppedAtISO: '' }));
  if (added.length === 0) return 0;
  await db.update(creationSessionObjects)
    .set({ content: { ...content, enrolments: [...current, ...added] }, updatedAt: input.now })
    .where(eq(creationSessionObjects.id, sequence.id));
  await db.update(creationSessions)
    .set({ canvasRevision: sql`${creationSessions.canvasRevision} + 1`, lastActivityAt: input.now })
    .where(scopedToTenant(creationSessions, scope.tenantId, eq(creationSessions.id, sequence.sessionId)));
  return added.length;
}

export interface FollowUpMeasurement {
  before: number;
  after: number;
  delta: number;
}

/**
 * Enrolled vs matched-not-enrolled conversion since the enrolment, once
 * {@link FOLLOW_UP_WINDOW_DAYS} have passed. Null while waiting or without both groups.
 */
export async function measureFollowUp(
  env: Env,
  db: Db,
  scope: ReplayScope,
  row: PrescriptionRow,
  sequenceObjectId: string,
  now: Date,
): Promise<FollowUpMeasurement | null> {
  const sequence = await loadSequence(db, scope.tenantId, sequenceObjectId);
  const known = await resolveKnownContacts(env, db, scope, await cohortVisitorIds(env, db, scope, row, now));
  const enrolments = readSequenceEnrolments(asJsonRecord(sequence.content).enrolments);
  const enrolledAt = new Map(enrolments.map((e) => [e.contactRef.toLowerCase(), Date.parse(e.enrolledAtISO)]));
  const enrolled = known.matched.filter((c) => enrolledAt.has(c.email.toLowerCase()));
  const others = known.matched.filter((c) => !enrolledAt.has(c.email.toLowerCase()));
  if (enrolled.length === 0 || others.length === 0) return null;
  const start = Math.min(...enrolled.map((c) => enrolledAt.get(c.email.toLowerCase()) ?? now.getTime()));
  if (!Number.isFinite(start) || now.getTime() - start < FOLLOW_UP_WINDOW_DAYS * DAY_MS) return null;

  const visitors = [...enrolled, ...others].flatMap((c) => c.visitorIds);
  const converted = new Set((await replayTelemetryDb(env, db)
    .select({ visitorId: replayRecordings.visitorId })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      inArray(replayRecordings.visitorId, visitors),
      gte(replayRecordings.startedAt, new Date(start)),
      eq(replayRecordings.converted, true),
    ))).map((r) => r.visitorId));
  const share = (group: typeof enrolled) => group.filter((c) => c.visitorIds.some((v) => converted.has(v))).length / group.length;
  const after = share(enrolled);
  const before = share(others);
  return { before, after, delta: after - before };
}
