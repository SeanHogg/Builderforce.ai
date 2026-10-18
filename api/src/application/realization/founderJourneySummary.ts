/**
 * The facts `useFounderJourney` places a workspace on the arc from, as ONE cached
 * summary read — `GET /api/realizations/journey-summary`.
 *
 * The hook used to fetch three full lists and a fourth on demand: every company
 * (with its project / room / gap / round counts) to learn whether ONE non-portfolio
 * company exists; thirty active Creation Sessions (preview JSONB and two correlated
 * subqueries each) to learn the newest one's id; and every proof of that session to
 * read the newest one's verdict. Each is now an existence / single-row read of the
 * one column the answer needs, and the whole summary is cached for a minute per
 * (workspace, segment, person) — sessions are per member, so the person is in the key.
 *
 * The journey POLICY (which fact wins, which act a verdict means) stays in the hook;
 * this only gathers the facts, so the two cannot disagree about precedence.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { ProofJourneySignalDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { companies, creationSessionMembers, creationSessions, realizations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { journeySignal } from './journeySignal';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SUMMARY_CACHE = { kvTtlSeconds: 60, l1TtlMs: 30_000 };

export interface FounderJourneySummaryDto {
  /** The workspace owns at least one company that is not a portfolio holding. */
  ownsCompany: boolean;
  /** The Make / Measure signal from the newest proof (`journeySignal.ts`). */
  signal: ProofJourneySignalDto;
  /** The person's most recently active Creation Session, or null. */
  activeSessionId: string | null;
  /** That session's newest proof, or null when it has none (or there is no session). */
  activeSessionLatestProof: { verdict: string | null } | null;
}

export interface JourneyScope { tenantId: number; segmentId: string; userId: string }

async function loadSummary(env: Env, db: Db, scope: JourneyScope): Promise<FounderJourneySummaryDto> {
  const { tenantId, segmentId, userId } = scope;
  const [ownedCompany, signal, session] = await Promise.all([
    db.select({ id: companies.id }).from(companies)
      .where(scopedToTenant(companies, tenantId, eq(companies.isPortfolio, false)))
      .limit(1),
    // A failed signal must not blank the whole position — the other facts still place it.
    journeySignal(env, db, tenantId).catch((error: unknown): ProofJourneySignalDto => {
      reportCaughtError(error, { source: 'application/realization/founderJourneySummary.ts', operation: 'journeySignal', level: 'warning' });
      return { stage: null, realizationId: null };
    }),
    db.select({ id: creationSessions.id }).from(creationSessions)
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .where(and(eq(creationSessions.tenantId, tenantId), eq(creationSessions.segmentId, segmentId), eq(creationSessions.status, 'active')))
      .orderBy(desc(creationSessions.lastActivityAt))
      .limit(1),
  ]);
  const activeSessionId = session[0]?.id ?? null;
  const ownsCompany = ownedCompany.length > 0;
  // The proof is only read when it can decide the answer (no company, no signal).
  const latestProof = activeSessionId && !ownsCompany && !signal.stage
    ? await db.select({ verdict: realizations.verdict }).from(realizations)
      .where(scopedToTenant(realizations, tenantId, eq(realizations.sessionId, activeSessionId)))
      .orderBy(desc(realizations.createdAt))
      .limit(1)
    : [];
  return {
    ownsCompany,
    signal,
    activeSessionId,
    activeSessionLatestProof: latestProof[0] ? { verdict: latestProof[0].verdict ?? null } : null,
  };
}

export function founderJourneySummary(env: Env, db: Db, scope: JourneyScope): Promise<FounderJourneySummaryDto> {
  return getOrSetCached(env, `founder-journey:t${scope.tenantId}:s${scope.segmentId}:u${scope.userId}`, () => loadSummary(env, db, scope), SUMMARY_CACHE);
}
