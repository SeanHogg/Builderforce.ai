/**
 * `resolveSpecialist` — THE read routing does to ask "is a cheap model admitted for
 * this job?" (cost lever E2).
 *
 * Returns the admitted model with the best score-to-frontier ratio for the job, or
 * null when the lever is off for the tenant, nothing is admitted, or the read failed.
 * Null means "use today's model" — a caller never errors on it.
 *
 * Admissions are read through the shared read-through cache (KV + per-isolate L1),
 * so the hot path costs no database round trip; the weekly sweep invalidates the key
 * whenever a verdict changes a row.
 */

import { isCostLeverOn } from '@builderforce/cost-levers';
import type { Env } from '../../../env';
import { buildDatabase } from '../../../infrastructure/database/connection';
import { getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { parityRatio } from './admission';
import { loadActiveAdmissions, SPECIALIST_ADMISSIONS_CACHE_KEY, type SpecialistAdmission } from './admissionStore';
import type { SpecialistJobId } from './registry';

export interface SpecialistChoice {
  jobId: SpecialistJobId;
  model: string;
  /** Candidate score ÷ frontier score on the job's eval set at the latest evaluation. */
  ratio: number;
  dataset: string;
  evaluatedAt: string;
}

export interface ResolveSpecialistDeps {
  load?: () => Promise<SpecialistAdmission[]>;
}

/** The best active admission for `jobId` among `admissions`, or null. Pure. */
export function pickAdmission(admissions: readonly SpecialistAdmission[], jobId: SpecialistJobId): SpecialistChoice | null {
  let best: SpecialistChoice | null = null;
  for (const a of admissions) {
    if (a.jobId !== jobId) continue;
    const ratio = parityRatio(a.score, a.frontierScore);
    if (ratio === null || (best && best.ratio >= ratio)) continue;
    best = { jobId, model: a.model, ratio, dataset: a.dataset, evaluatedAt: a.evaluatedAt };
  }
  return best;
}

export async function resolveSpecialist(
  env: Env,
  tenantId: number | string | null | undefined,
  jobId: SpecialistJobId,
  deps: ResolveSpecialistDeps = {},
): Promise<SpecialistChoice | null> {
  if (!isCostLeverOn(env, 'e2_specialists', tenantId)) return null;
  try {
    const load = deps.load ?? (() => loadActiveAdmissions(buildDatabase(env)));
    const admissions = await getOrSetCached(env, SPECIALIST_ADMISSIONS_CACHE_KEY, load, { kvTtlSeconds: 3_600, l1TtlMs: 60_000 });
    return pickAdmission(admissions, jobId);
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/specialists/resolveSpecialist.ts', operation: 'resolveSpecialist', context: { jobId } });
    return null;
  }
}
