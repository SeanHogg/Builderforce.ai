/**
 * The weekly specialist eval sweep (cost lever E2).
 *
 * For every job in the registry:
 *   1. read its held-out eval set (`evalCaseStore`), and fill any missing frontier
 *      reference output by asking the job's reference model once;
 *   2. with at least `evalSet.minCases` referenced cases, replay every case through
 *      each candidate (strict pin, temperature 0 — a score change means the model
 *      changed, not the dice) and score it against the references (`scoring.ts`);
 *   3. apply the shared frontier-parity rule (`admission.ts`) and record the verdict
 *      (`admissionStore`): admit, renew, or REVOKE an active admission whose score
 *      drifted under the bar.
 * Too few cases is no verdict: existing admissions stand until the set can judge them.
 *
 * Every model call goes through the metered gateway (`llmProxyForPlan`), never
 * out-of-band access — the same rule the agent benchmark sweep follows. The pass is
 * bounded: at most `maxCases` cases per job, a handful of candidates, and a wall-clock
 * budget after which unfinished candidates get no verdict this week.
 */

import { costLeverRollout } from '@builderforce/cost-levers';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { invalidateCached } from '../../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { EvalJudge } from '../../eval/semanticEval';
import { llmProxyForPlan, readProxyChoice } from '../LlmProxyService';
import type { ChatCompletionRequest } from '../proxyTypes';
import { frontierParity } from './admission';
import { recordAdmissionVerdict, SPECIALIST_ADMISSIONS_CACHE_KEY, type AdmissionChange } from './admissionStore';
import { listEvalCases, storeReferenceOutput, type SpecialistEvalCase, type SpecialistRequest } from './evalCaseStore';
import { specialistBar, SPECIALIST_JOBS, type SpecialistJob, type SpecialistJobId } from './registry';
import { scoreJob, type ScoredPair } from './scoring';

/** Wall-clock budget of one pass. Unfinished candidates get no verdict this week. */
export const SPECIALIST_SWEEP_BUDGET_MS = 8 * 60_000;

/** The model calls a pass makes — the gateway in production, fakes in tests. */
export interface SpecialistEvalPorts {
  /** One strict-pinned completion; null on any failure or empty answer. */
  complete(model: string, request: SpecialistRequest): Promise<string | null>;
  /** The judge for `judge`-scored jobs, pinned to the job's reference model. */
  judgeFor(job: SpecialistJob): EvalJudge;
  now(): Date;
}

/** The production ports: the metered gateway on the strongest plan pool, strict pins. */
export function gatewaySpecialistPorts(env: Env): SpecialistEvalPorts {
  const proxy = llmProxyForPlan(env, 'teams', true, { disablePaidOverflow: true });
  const complete = async (model: string, request: SpecialistRequest): Promise<string | null> => {
    try {
      const body = { ...request, model, modelStrict: true, temperature: 0 } as ChatCompletionRequest;
      const result = await proxy.complete(body);
      if (result.response.status >= 400) return null;
      const { content } = await readProxyChoice(result);
      return content || null;
    } catch (error) {
      reportCaughtError(error, { source: 'application/llm/specialists/evalSweep.ts', operation: 'complete', context: { model } });
      return null;
    }
  };
  return {
    complete,
    judgeFor: (job) => async (prompt) => (await complete(job.referenceModel, { messages: [{ role: 'user', content: prompt }], max_tokens: 200 })) ?? '',
    now: () => new Date(),
  };
}

export interface SpecialistJobOutcome {
  jobId: SpecialistJobId;
  status: 'evaluated' | 'insufficient_cases' | 'out_of_time';
  cases: number;
  verdicts: Array<{ model: string; ratio: number | null; change: AdmissionChange | 'unscored' }>;
}

export interface SpecialistSweepResult {
  skipped: boolean;
  jobs: SpecialistJobOutcome[];
}

/** Run one pass over every job. Never throws: a job that fails is reported and skipped. */
export async function runSpecialistEvalSweep(
  env: Env,
  db: Db,
  ports: SpecialistEvalPorts = gatewaySpecialistPorts(env),
  budgetMs: number = SPECIALIST_SWEEP_BUDGET_MS,
): Promise<SpecialistSweepResult> {
  if (costLeverRollout(env, 'e2_specialists') <= 0) return { skipped: true, jobs: [] };
  const deadline = Date.now() + budgetMs;
  const jobs: SpecialistJobOutcome[] = [];
  let changed = false;
  for (const job of SPECIALIST_JOBS) {
    try {
      const outcome = await evaluateJob(db, job, ports, deadline);
      // A renewal re-scores an active row, which can change which model routing picks.
      if (outcome.verdicts.some((v) => v.change === 'admitted' || v.change === 'revoked' || v.change === 'renewed')) changed = true;
      jobs.push(outcome);
    } catch (error) {
      reportCaughtError(error, { source: 'application/llm/specialists/evalSweep.ts', operation: 'evaluateJob', context: { jobId: job.id } });
    }
  }
  if (changed) await invalidateCached(env, SPECIALIST_ADMISSIONS_CACHE_KEY);
  return { skipped: false, jobs };
}

async function evaluateJob(db: Db, job: SpecialistJob, ports: SpecialistEvalPorts, deadline: number): Promise<SpecialistJobOutcome> {
  const outcome = (status: SpecialistJobOutcome['status'], cases: number, verdicts: SpecialistJobOutcome['verdicts'] = []): SpecialistJobOutcome =>
    ({ jobId: job.id, status, cases, verdicts });
  const cases = await listEvalCases(db, job.id, job.evalSet.maxCases);
  const referenced: Array<SpecialistEvalCase & { referenceOutput: string }> = [];
  for (const c of cases) {
    if (c.referenceOutput !== null) { referenced.push({ ...c, referenceOutput: c.referenceOutput }); continue; }
    if (Date.now() > deadline) break;
    const reference = await ports.complete(job.referenceModel, c.request);
    if (reference === null) continue;
    await storeReferenceOutput(db, c.id, reference, job.referenceModel, ports.now());
    referenced.push({ ...c, referenceOutput: reference });
  }
  if (referenced.length < job.evalSet.minCases) return outcome(Date.now() > deadline ? 'out_of_time' : 'insufficient_cases', referenced.length);

  const judge = ports.judgeFor(job);
  const frontierJudged = new Map<number, number | null>();
  const verdicts: SpecialistJobOutcome['verdicts'] = [];
  for (const model of job.candidates) {
    const pairs: ScoredPair[] = [];
    for (const evalCase of referenced) {
      if (Date.now() > deadline) break;
      pairs.push({ evalCase, candidate: await ports.complete(model, evalCase.request) });
    }
    if (pairs.length < referenced.length) return outcome('out_of_time', referenced.length, verdicts);
    const scores = await scoreJob(job, pairs, judge, frontierJudged);
    if (scores.candidate.cases < job.evalSet.minCases) {
      verdicts.push({ model, ratio: null, change: 'unscored' });
      continue;
    }
    const parity = frontierParity(scores.candidate, scores.frontier, specialistBar(job));
    const change = await recordAdmissionVerdict(db, {
      jobId: job.id,
      model,
      dataset: scores.candidate.dataset,
      cases: scores.candidate.cases,
      score: scores.candidate.meanScore,
      frontierScore: scores.frontier.meanScore,
      frontierModel: job.referenceModel,
      admitted: parity.admitted,
    }, ports.now());
    verdicts.push({ model, ratio: parity.ratio, change });
  }
  return outcome('evaluated', referenced.length, verdicts);
}

/** One-line cron summary, or null when the pass did nothing worth a log line. */
export function describeSpecialistSweep(r: SpecialistSweepResult): string | null {
  if (r.skipped || r.jobs.length === 0) return null;
  return r.jobs
    .map((j) => `${j.jobId}:${j.status}(cases=${j.cases}${j.verdicts.map((v) => ` ${v.model}=${v.change}${v.ratio != null ? `@${v.ratio.toFixed(2)}` : ''}`).join('')})`)
    .join(' ');
}
