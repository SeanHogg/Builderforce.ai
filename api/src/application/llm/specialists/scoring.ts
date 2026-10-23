/**
 * Score one candidate against the frontier references of a job's eval set, as the two
 * {@link EvalSummary} reports the parity rule compares (`admission.ts`).
 *
 * Both summaries are built over the SAME cases, so "the same eval" holds by
 * construction: a case one side could not be scored on is dropped from both.
 *
 *   • `label` jobs — the frontier's label IS the reference, so the frontier scores 1 on
 *     every case with a valid reference label, and the candidate scores its agreement.
 *   • `judge` jobs — ONE pinned judge rates both outputs per case with the shared
 *     semantic-eval rubric (`eval/semanticEval.ts`): the case's system instruction is
 *     the question, its input the context. A case whose judge verdict fell back to the
 *     lexical backend on EITHER side is dropped — mixing the two methods would compare
 *     different rulers.
 */

import { evaluateResponse, type EvalJudge } from '../../eval/semanticEval';
import type { EvalSummary } from './admission';
import type { SpecialistEvalCase, SpecialistRequest } from './evalCaseStore';
import type { SpecialistJob } from './registry';

/** One case's reference and candidate outputs (`candidate: null` = the call failed). */
export interface ScoredPair {
  evalCase: SpecialistEvalCase & { referenceOutput: string };
  candidate: string | null;
}

export interface JobScores {
  candidate: EvalSummary;
  frontier: EvalSummary;
}

/** The dataset name a job's summaries carry. */
export const specialistDataset = (jobId: string): string => `specialist:${jobId}`;

/** Judge input is capped so a long transcript cannot blow up the judge call. */
const MAX_JUDGE_CONTEXT_CHARS = 12_000;

/** The rubric materials of one case: its system instruction and its input. */
export function judgeMaterials(request: SpecialistRequest, answer: string): { question: string; context: string; answer: string } {
  const question = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const context = request.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
  return { question: question || 'Complete the task in the input.', context: context.slice(0, MAX_JUDGE_CONTEXT_CHARS), answer };
}

/**
 * Score the pairs. `frontierJudged` memoises the judge's verdict on a case's reference
 * across candidates (same judge, same text ⇒ same verdict), so the frontier side is
 * judged once per case per pass.
 */
export async function scoreJob(
  job: SpecialistJob,
  pairs: readonly ScoredPair[],
  judge: EvalJudge,
  frontierJudged: Map<number, number | null> = new Map(),
): Promise<JobScores> {
  const candidateScores: number[] = [];
  const frontierScores: number[] = [];
  for (const { evalCase, candidate } of pairs) {
    if (job.scorer.kind === 'label') {
      const reference = job.scorer.labelOf(evalCase.referenceOutput);
      if (reference === null) continue;
      frontierScores.push(1);
      candidateScores.push(candidate !== null && job.scorer.labelOf(candidate) === reference ? 1 : 0);
      continue;
    }
    if (!frontierJudged.has(evalCase.id)) {
      const ref = await evaluateResponse(judgeMaterials(evalCase.request, evalCase.referenceOutput), { judge });
      frontierJudged.set(evalCase.id, ref.method === 'llm' ? ref.overall : null);
    }
    const frontier = frontierJudged.get(evalCase.id) ?? null;
    if (frontier === null) continue;
    if (candidate === null || !candidate.trim()) {
      // A failed or empty answer is a real miss for the candidate, not an unscored case.
      frontierScores.push(frontier);
      candidateScores.push(0);
      continue;
    }
    const verdict = await evaluateResponse(judgeMaterials(evalCase.request, candidate), { judge });
    if (verdict.method !== 'llm') continue;
    frontierScores.push(frontier);
    candidateScores.push(verdict.overall);
  }
  const dataset = specialistDataset(job.id);
  return {
    candidate: { dataset, meanScore: mean(candidateScores), cases: candidateScores.length },
    frontier: { dataset, meanScore: mean(frontierScores), cases: frontierScores.length },
  };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
