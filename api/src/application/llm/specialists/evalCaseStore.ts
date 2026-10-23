/**
 * Specialist eval cases — the one reader/writer of `llm_specialist_eval_cases` (1257).
 *
 * Nothing already stored could serve as a job's held-out eval set: `llm_traces` does
 * not record the internal summarizer / classifier calls at all, caps bodies at 20K and
 * is purged after 30 days, and usage rows carry no text. So each job's set is built
 * forward: the job's call sites hand their exact request to
 * {@link captureSpecialistSample}, which keeps a sampled share
 * (`evalSet.captureRate`) until the job holds `evalSet.maxCases` cases. The weekly
 * sweep then asks the job's frontier reference model for each case's reference output
 * once ({@link storeReferenceOutput}). Cases are never used to train anything, so the
 * whole set is held out.
 *
 * Capture is best-effort and never on the caller's critical path: any failure is
 * reported and dropped. It runs only while lever E2 is rolled out to someone —
 * fully off, nothing is captured.
 */

import { asc, count, eq } from 'drizzle-orm';
import { costLeverRollout } from '@builderforce/cost-levers';
import type { Env } from '../../../env';
import { buildDatabase, type Db } from '../../../infrastructure/database/connection';
import { llmSpecialistEvalCases } from '../../../infrastructure/database/schema';
import { acrossTenants } from '../../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../../infrastructure/cache/readThroughCache';
import { redactSecrets } from '../../../infrastructure/security/redactSecrets';
import { sha256Hex } from '../../../domain/shared/hash';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { specialistJob, type SpecialistJobId } from './registry';

/** The replayable part of a job's chat request. */
export interface SpecialistRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
  response_format?: unknown;
}

/** A case as the sweep reads it. */
export interface SpecialistEvalCase {
  id: number;
  request: SpecialistRequest;
  referenceOutput: string | null;
}

/** Larger requests are not captured: replaying them costs more than they teach. */
export const MAX_CAPTURED_REQUEST_CHARS = 40_000;

const caseCountKey = (jobId: SpecialistJobId): string => `llm:specialist-cases:v1:${jobId}`;

export interface CaptureDeps {
  db?: Db;
  random?: () => number;
}

/**
 * Keep this job input as an eval case, when the sample draw, the job's cap and the size
 * limit allow. Never throws; resolves once the (rare) write is done.
 */
export async function captureSpecialistSample(
  env: Env,
  sample: { jobId: SpecialistJobId; tenantId: number | null | undefined; request: SpecialistRequest },
  deps: CaptureDeps = {},
): Promise<void> {
  try {
    if (sample.tenantId == null || costLeverRollout(env, 'e2_specialists') <= 0) return;
    const job = specialistJob(sample.jobId);
    if ((deps.random ?? Math.random)() >= job.evalSet.captureRate) return;
    const body = redactSecrets(JSON.stringify(replayable(sample.request)));
    if (body.length > MAX_CAPTURED_REQUEST_CHARS) return;
    const db = deps.db ?? buildDatabase(env);
    const held = await getOrSetCached(env, caseCountKey(job.id), () => countCases(db, job.id), { kvTtlSeconds: 3_600, l1TtlMs: 600_000 });
    if (held >= job.evalSet.maxCases) return;
    await db
      .insert(llmSpecialistEvalCases)
      .values({ tenantId: sample.tenantId, jobId: job.id, inputHash: await sha256Hex(`${job.id}\n${body}`), request: body })
      .onConflictDoNothing({ target: [llmSpecialistEvalCases.jobId, llmSpecialistEvalCases.inputHash] });
    await invalidateCached(env, caseCountKey(job.id));
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/specialists/evalCaseStore.ts', operation: 'captureSpecialistSample', context: { jobId: sample.jobId } });
  }
}

/** Only the fields a replay needs — never a tool schema, stream flag or caller pin. */
function replayable(request: SpecialistRequest): SpecialistRequest {
  return {
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(request.max_tokens != null ? { max_tokens: request.max_tokens } : {}),
    ...(request.response_format != null ? { response_format: request.response_format } : {}),
  };
}

async function countCases(db: Db, jobId: SpecialistJobId): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(llmSpecialistEvalCases)
    .where(acrossTenants(llmSpecialistEvalCases, 'platform_aggregate', eq(llmSpecialistEvalCases.jobId, jobId)));
  return Number(row?.n ?? 0);
}

/** The job's eval set, oldest first, at most `limit` cases. Unparseable rows are skipped. */
export async function listEvalCases(db: Db, jobId: SpecialistJobId, limit: number): Promise<SpecialistEvalCase[]> {
  const rows = await db
    .select({ id: llmSpecialistEvalCases.id, request: llmSpecialistEvalCases.request, referenceOutput: llmSpecialistEvalCases.referenceOutput })
    .from(llmSpecialistEvalCases)
    .where(acrossTenants(llmSpecialistEvalCases, 'scheduled_sweep', eq(llmSpecialistEvalCases.jobId, jobId)))
    .orderBy(asc(llmSpecialistEvalCases.id))
    .limit(limit);
  const cases: SpecialistEvalCase[] = [];
  for (const row of rows) {
    const request = parseRequest(row.request);
    if (request) cases.push({ id: row.id, request, referenceOutput: row.referenceOutput ?? null });
  }
  return cases;
}

function parseRequest(raw: string): SpecialistRequest | null {
  try {
    const value = JSON.parse(raw) as SpecialistRequest;
    return Array.isArray(value?.messages) && value.messages.length > 0 ? value : null;
  } catch {
    // A row this module did not write well is no case at all — skipped, never scored.
    return null;
  }
}

/** Record the frontier reference output of one case. */
export async function storeReferenceOutput(db: Db, caseId: number, output: string, model: string, now: Date): Promise<void> {
  await db
    .update(llmSpecialistEvalCases)
    .set({ referenceOutput: output, referenceModel: model, referencedAt: now })
    .where(acrossTenants(llmSpecialistEvalCases, 'scheduled_sweep', eq(llmSpecialistEvalCases.id, caseId)));
}
