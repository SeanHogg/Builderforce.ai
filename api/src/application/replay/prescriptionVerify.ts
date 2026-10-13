/**
 * The prescription VERIFIER (PRD 33 §5.1.5) — the writer of `measured` and the
 * verdict statuses of `replay_prescriptions`.
 *
 * `VERIFIERS` is a registry by the action a person took (data, no branches in
 * callers):
 *   fix / ticket → the ticket's measured effect (`ticketEffect.effectFor`), in the
 *                  direction its metric improves (conversions up, frustration/errors down);
 *   test         → `variantResults` — which withholds lift until both arms reach the
 *                  test's minimum sample, so a verdict here is never a day-two read;
 *                  a decided test is concluded, which switches the split off;
 *   follow_up    → enrolled vs matched-not-enrolled conversion after 14 days.
 * A verdict writes `measured`, moves the status to worked / no_effect / worse,
 * settles the linked issue group, and records `prescription.verify` (phase
 * `validated`, the delta as the metric) in the outcome ledger.
 *
 * Runs daily (after the sweep) and on read of one prescription (throttled).
 */

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionProjectLinks,
  creationSessions,
  replayIssues,
  replayPrescriptions,
  tasks,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { ReplayScope } from '../../domain/replay/replayScope';
import {
  decodeActionRef,
  verdictFor,
  type PrescriptionRefs,
} from '../../domain/replay/prescriptions/prescriptionState';
import { asJsonRecord } from '../../domain/shared/json';
import { recordOutcomeEvent } from '../outcomes/outcomeLedger';
import { stopTest, variantResults } from '../marketing/experimentation';
import { SYSTEM_ACTOR } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { effectFor } from './ticketEffect';
import { measureFollowUp } from './prescriptionFollowUp';
import { loadPrescriptionRow, type PrescriptionRow } from './prescriptionReads';
import { bumpReplaySitesVersion, bumpSiteVersion, prescriptionVerifyGateKey } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { getSite, type ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/prescriptionVerify.ts';
/** Statuses a verdict can still land on. */
export const VERIFIABLE_STATUSES = ['applied', 'measuring'];
const VERIFY_PER_SITE = 50;
const VERIFY_ON_READ_SECONDS = 600;

export interface Measurement {
  before: number | null;
  after: number | null;
  delta: number;
  verdict: 'worked' | 'no_effect' | 'worse';
  source: 'ticket_effect' | 'ab_test' | 'follow_up';
  releaseKey: string | null;
}

export interface VerifyContext {
  env: Env;
  db: Db;
  scope: ReplayScope;
  row: PrescriptionRow;
  refs: PrescriptionRefs;
  now: Date;
}

export type Verifier = (ctx: VerifyContext) => Promise<Measurement | null>;

const viaTicketEffect: Verifier = async ({ env, db, scope, refs }) => {
  if (refs.taskId === null) return null;
  const effect = await effectFor(env, db, { tenantId: scope.tenantId, taskId: refs.taskId });
  if (!effect || effect.status !== 'measured' || effect.delta === null) return null;
  const direction = effect.metric === 'conversions' ? 'up' : 'down';
  return {
    before: effect.before.rate,
    after: effect.after?.rate ?? null,
    delta: effect.delta,
    verdict: verdictFor(effect.delta, effect.before.rate, direction),
    source: 'ticket_effect',
    releaseKey: effect.after?.releaseKey ?? null,
  };
};

const viaAbTest: Verifier = async ({ db, scope, refs }) => {
  if (refs.testId === null) return null;
  const results = await variantResults(db, scope.tenantId, refs.testId);
  if (results.underpowered) return null;
  const control = results.variants.find((v) => v.isControl);
  const arm = results.variants.find((v) => !v.isControl);
  if (!control || !arm || control.rate === null || arm.rate === null) return null;
  const delta = arm.rate - control.rate;
  return { before: control.rate, after: arm.rate, delta, verdict: verdictFor(delta, control.rate, 'up'), source: 'ab_test', releaseKey: refs.previewRelease };
};

const viaFollowUp: Verifier = async ({ env, db, scope, row, refs, now }) => {
  if (!refs.sequenceObjectId) return null;
  const measured = await measureFollowUp(env, db, scope, row, refs.sequenceObjectId, now);
  if (!measured) return null;
  return { ...measured, verdict: verdictFor(measured.delta, measured.before, 'up'), source: 'follow_up', releaseKey: null };
};

/** Which verifier measures which action. */
export const VERIFIERS: Readonly<Record<string, Verifier>> = {
  fix: viaTicketEffect,
  ticket: viaTicketEffect,
  test: viaAbTest,
  follow_up: viaFollowUp,
};

/** The board this site's project is (or the fix ticket's project's), for the outcome ledger. */
async function outcomeSessionFor(db: Db, site: ReplaySiteRecord, refs: PrescriptionRefs): Promise<{ sessionId: string; projectId: number } | null> {
  let projectId = site.projectId;
  if (projectId === null && refs.taskId !== null) {
    const [task] = await db.select({ projectId: tasks.projectId }).from(tasks)
      .where(scopedToTenant(tasks, site.tenantId, eq(tasks.id, refs.taskId))).limit(1);
    projectId = task?.projectId ?? null;
  }
  if (projectId === null) return null;
  const [link] = await db
    .select({ sessionId: creationSessionProjectLinks.sessionId })
    .from(creationSessionProjectLinks)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
    .where(scopedToTenant(creationSessions, site.tenantId, eq(creationSessionProjectLinks.projectId, projectId), sql`${creationSessions.status} <> 'deleted'`))
    .orderBy(desc(sql`(${creationSessionProjectLinks.linkKind} = 'app')`), desc(creationSessionProjectLinks.createdAt))
    .limit(1);
  return link ? { sessionId: link.sessionId, projectId } : null;
}

/** `prescription.verify` in the outcome ledger. Best-effort: measurement never fails a verdict. */
async function recordVerifyOutcome(db: Db, site: ReplaySiteRecord, row: PrescriptionRow, refs: PrescriptionRefs, m: Measurement): Promise<void> {
  try {
    const subject = await outcomeSessionFor(db, site, refs);
    if (!subject) return;
    const acceptance = asJsonRecord(row.acceptance);
    await recordOutcomeEvent(db, {
      correlationId: row.id,
      sessionId: subject.sessionId,
      tenantId: site.tenantId,
      projectId: subject.projectId,
      actorType: 'system',
      actorRef: 'insights',
      action: 'prescription.verify',
      phase: 'validated',
      metricKey: typeof acceptance.metric === 'string' ? acceptance.metric : 'conversion_rate',
      metricValue: m.delta,
      unit: 'rate',
      metadata: { ruleId: row.ruleId, verdict: m.verdict, source: m.source, siteId: site.id },
    });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'recordVerifyOutcome' });
  }
}

/** Measure one prescription; true when a verdict was written. */
export async function verifyPrescription(env: Env, db: Db, site: ReplaySiteRecord, row: PrescriptionRow, now: Date): Promise<boolean> {
  if (!VERIFIABLE_STATUSES.includes(row.status)) return false;
  const verifier = VERIFIERS[row.actionKind ?? ''];
  if (!verifier) return false;
  const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.id };
  const refs = decodeActionRef(row.actionRef);
  const m = await verifier({ env, db, scope, row, refs, now });
  if (!m) return false;

  const measured = { before: m.before, after: m.after, delta: m.delta, verdict: m.verdict, source: m.source, releaseKey: m.releaseKey, measuredAt: now.toISOString() };
  const [updated] = await db
    .update(replayPrescriptions)
    .set({ measured, status: m.verdict, updatedAt: now })
    .where(and(eq(replayPrescriptions.id, row.id), inArray(replayPrescriptions.status, VERIFIABLE_STATUSES)))
    .returning({ id: replayPrescriptions.id });
  if (!updated) return false;

  if (m.source === 'ab_test' && refs.testId !== null) {
    // A decided test stops splitting traffic.
    await stopTest(db, env, site.tenantId, SYSTEM_ACTOR, refs.testId, true).catch((error) =>
      reportCaughtError(error, { source: SOURCE, operation: 'concludeTest' }));
    await bumpReplaySitesVersion(env, site.tenantId, site.id);
  }
  const issueId = asJsonRecord(row.finding).issueId;
  if (typeof issueId === 'string' && issueId) {
    await replayTelemetryDb(env, db)
      .update(replayIssues)
      .set({ status: m.verdict === 'worked' ? 'verified' : 'ongoing', updatedAt: now })
      .where(and(
        eq(replayIssues.tenantId, site.tenantId),
        eq(replayIssues.siteId, site.id),
        eq(replayIssues.id, issueId),
        eq(replayIssues.prescriptionId, row.id),
      ));
  }
  await recordVerifyOutcome(db, site, row, refs, m);
  await bumpSiteVersion(env, site.id);
  return true;
}

/** Every measurable prescription of a site (the daily pass). Returns verdicts written. */
export async function verifySite(env: Env, db: Db, site: ReplaySiteRecord, opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select()
    .from(replayPrescriptions)
    .where(and(
      eq(replayPrescriptions.siteId, site.id),
      inArray(replayPrescriptions.status, VERIFIABLE_STATUSES),
      isNotNull(replayPrescriptions.actionKind),
    ))
    .limit(VERIFY_PER_SITE);
  let verified = 0;
  for (const row of rows) {
    try {
      if (await verifyPrescription(env, db, site, row, now)) verified += 1;
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'verifySite', context: { siteId: site.id } });
    }
  }
  return verified;
}

/** On read of one prescription: verify it at most every ten minutes. Never throws. */
export async function verifyOnRead(env: Env, db: Db, scope: ReplayScope, prescriptionId: string, now: Date = new Date()): Promise<void> {
  try {
    const gate = prescriptionVerifyGateKey(prescriptionId);
    if (await peekCached<boolean>(env, gate)) return;
    await setCached(env, gate, true, { kvTtlSeconds: VERIFY_ON_READ_SECONDS });
    const row = await loadPrescriptionRow(db, scope, prescriptionId);
    if (!VERIFIABLE_STATUSES.includes(row.status)) return;
    const site = await getSite(env, db, scope.siteId);
    if (!site || site.tenantId !== scope.tenantId) return;
    await verifyPrescription(env, db, site, row, now);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'verifyOnRead' });
  }
}
