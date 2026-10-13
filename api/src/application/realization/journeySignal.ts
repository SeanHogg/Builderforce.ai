/**
 * The founder's Make / Measure position, from data that already exists (PRD 33 §5.3.5).
 *
 * `useFounderJourney` places a workspace on the arc. Idea and Run had signals
 * (sessions, companies); Make and Measure did not, so they never lit up. They do
 * now, from the workspace's newest proof:
 *
 *   • graded (met / missed / abandoned) or none at all → no signal: the founder is
 *     back at Idea, reading again with what the proof taught them;
 *   • planned, building, or built with nobody on it yet → `make`;
 *   • built, and its hosted site has had its first visitor → `measure`.
 *
 * Cached per workspace under a version token, bumped by every write that can move
 * it: a realization created or built, a verdict written, and the first visitor
 * event on a hosted site (`ReplayIngestService.settle`).
 */

import type { ProofJourneySignalDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { firstTraceAt, REPLAY_TRACE_VERBS } from '../replay/replayTrace';
import { projectSiteDto } from '../replay/replaySiteAdmin';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { listRealizations, type RealizationView } from './realizationStore';

const TTL = { kvTtlSeconds: 600, l1TtlMs: 30_000 };
const versionKey = (tenantId: number) => `realization-journey:t${tenantId}`;

const NO_SIGNAL: ProofJourneySignalDto = { stage: null, realizationId: null };

/** The stage the newest proof puts the founder in. Pure. */
export function journeyStageFor(latest: Pick<RealizationView, 'id' | 'status' | 'verdict'> | null, hasVisitors: boolean): ProofJourneySignalDto {
  if (!latest || latest.verdict !== null) return NO_SIGNAL;
  if (latest.status === 'built' && hasVisitors) return { stage: 'measure', realizationId: latest.id };
  return { stage: 'make', realizationId: latest.id };
}

/** Whether the proof's hosted site has received its first visitor event. */
async function proofHasVisitors(env: Env, db: Db, tenantId: number, latest: RealizationView): Promise<boolean> {
  if (latest.status !== 'built' || latest.projectId == null) return false;
  const site = await projectSiteDto(env, db, tenantId, latest.projectId);
  if (!site) return false;
  return (await firstTraceAt(env, db, { tenantId, siteId: site.id, verb: REPLAY_TRACE_VERBS.ingestFirstEvent })) !== null;
}

export async function journeySignal(env: Env, db: Db, tenantId: number): Promise<ProofJourneySignalDto> {
  const version = await getCacheVersion(env, versionKey(tenantId));
  return getOrSetCached(env, `realization-journey:v:${version}:t${tenantId}`, async () => {
    const [latest] = await listRealizations(db, tenantId, 1);
    if (!latest) return NO_SIGNAL;
    return journeyStageFor(latest, await proofHasVisitors(env, db, tenantId, latest));
  }, TTL);
}

/** Orphan the workspace's cached signal. Never throws — a stale pill is not worth failing a write. */
export async function bumpJourneySignal(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  try {
    await bumpCacheVersion(env, versionKey(tenantId));
  } catch (error) {
    reportCaughtError(error, { source: 'application/realization/journeySignal.ts', operation: 'bumpJourneySignal' });
  }
}
