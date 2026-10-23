/**
 * Specialist admissions — the one reader/writer of `llm_specialist_admissions` (1257).
 *
 * An admission is a platform fact about a MODEL on ONE job (it scored ≥ the parity bar
 * of the frontier on that job's eval set), identical for every tenant, so the table has
 * no tenant column. The weekly sweep is the only writer; `resolveSpecialist` reads the
 * active rows through the read-through cache under {@link SPECIALIST_ADMISSIONS_CACHE_KEY},
 * which the sweep invalidates whenever a verdict changes a row.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { llmSpecialistAdmissions } from '../../../infrastructure/database/schema';
import type { SpecialistJobId } from './registry';

/** Read-through cache key of every ACTIVE admission. Bump the suffix on a shape change. */
export const SPECIALIST_ADMISSIONS_CACHE_KEY = 'llm:specialist-admissions:v1';

/** One active admission, as routing reads it (JSON-safe: it rides the KV cache). */
export interface SpecialistAdmission {
  jobId: string;
  model: string;
  dataset: string;
  cases: number;
  score: number;
  frontierScore: number;
  frontierModel: string | null;
  /** ISO timestamp. */
  admittedAt: string;
  /** ISO timestamp of the latest re-evaluation. */
  evaluatedAt: string;
}

/** Every admission not revoked. */
export async function loadActiveAdmissions(db: Db): Promise<SpecialistAdmission[]> {
  const rows = await db
    .select()
    .from(llmSpecialistAdmissions)
    .where(isNull(llmSpecialistAdmissions.revokedAt));
  return rows.map((r) => ({
    jobId: r.jobId,
    model: r.model,
    dataset: r.dataset,
    cases: r.cases,
    score: r.score,
    frontierScore: r.frontierScore,
    frontierModel: r.frontierModel ?? null,
    admittedAt: r.admittedAt.toISOString(),
    evaluatedAt: r.evaluatedAt.toISOString(),
  }));
}

/** One candidate's verdict from a sweep pass. */
export interface AdmissionVerdict {
  jobId: SpecialistJobId;
  model: string;
  dataset: string;
  cases: number;
  score: number;
  frontierScore: number;
  frontierModel: string;
  admitted: boolean;
}

/** What a verdict did to the table. */
export type AdmissionChange = 'admitted' | 'renewed' | 'revoked' | 'unchanged';

/**
 * Apply a verdict: admit (new row), renew (re-scored active row), revoke (active row
 * that fell under the bar — drift), or nothing (still not admitted).
 */
export async function recordAdmissionVerdict(db: Db, verdict: AdmissionVerdict, now: Date): Promise<AdmissionChange> {
  const activeOf = and(
    eq(llmSpecialistAdmissions.jobId, verdict.jobId),
    eq(llmSpecialistAdmissions.model, verdict.model),
    isNull(llmSpecialistAdmissions.revokedAt),
  );
  const [active] = await db.select({ id: llmSpecialistAdmissions.id }).from(llmSpecialistAdmissions).where(activeOf).limit(1);
  const scores = {
    dataset: verdict.dataset,
    cases: verdict.cases,
    score: verdict.score,
    frontierScore: verdict.frontierScore,
    frontierModel: verdict.frontierModel,
    evaluatedAt: now,
  };
  if (verdict.admitted) {
    if (active) {
      await db.update(llmSpecialistAdmissions).set(scores).where(eq(llmSpecialistAdmissions.id, active.id));
      return 'renewed';
    }
    await db.insert(llmSpecialistAdmissions).values({ jobId: verdict.jobId, model: verdict.model, ...scores, admittedAt: now });
    return 'admitted';
  }
  if (!active) return 'unchanged';
  await db
    .update(llmSpecialistAdmissions)
    .set({ ...scores, revokedAt: now, revokeReason: 'drift' })
    .where(eq(llmSpecialistAdmissions.id, active.id));
  return 'revoked';
}
