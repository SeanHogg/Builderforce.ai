/**
 * Gig-Marketplace proposal evaluation — "the employer uses AI to evaluate the
 * proposal against the requirements of the item they published."
 *
 * Reuses the platform's RAG-eval judge (semanticEval.evaluateResponse) rather than
 * inventing a second scorer: map the posting's requirements → the "question", the
 * submitted proposal → the "answer", and the fuller published scope → the "context".
 * The composite then reads as: does the proposal address the requirements
 * (answer-relevance) and stay grounded in the actual scope rather than over-promising
 * unrelated things (faithfulness)? Degrades to the deterministic lexical backend when
 * no judge is available, so evaluation is always possible.
 */
import { evaluateResponse, type EvalJudge, type EvalScores } from '../eval/semanticEval';

export interface ProposalEvalInput {
  /** The acceptance criteria / requirements the proposal must satisfy. */
  requirements: string;
  /** The fuller published scope (posting description, linked spec) used as grounding
   *  context. Falls back to `requirements` when omitted. */
  scope?: string;
  /** The proposal text under evaluation — a bid cover note or a deliverable body. */
  proposal: string;
}

/** Score a proposal against a posting's requirements. Pure given its inputs (the
 *  judge is injected) → unit-testable without a network. */
export async function evaluateProposal(
  input: ProposalEvalInput,
  opts?: { judge?: EvalJudge },
): Promise<EvalScores> {
  const context = (input.scope && input.scope.trim()) ? input.scope : input.requirements;
  return evaluateResponse(
    { question: input.requirements || '(no explicit requirements provided)', answer: input.proposal, context },
    opts,
  );
}

/** The 0..100 integer surfaced on lists/badges from a 0..1 composite. */
export const evalPercent = (overall: number): number => Math.round(Math.max(0, Math.min(1, overall)) * 100);
