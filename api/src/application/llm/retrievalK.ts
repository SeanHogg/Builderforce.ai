/**
 * Recall depth for the server-side memory paths (PRD C4 + C6) — the ONE place a fused,
 * scored candidate list becomes "what is sent".
 *
 * The depth arithmetic itself is `chooseK` in `@builderforce/agent-tools` (shared with the
 * desktop grounding and on-prem); this module only binds it to the cost levers and the
 * reranker so `memoryService` and `projectFactsRecall` do not each re-derive the order:
 *
 *   1. `c6_rerank` on and the query non-empty → the cross-encoder re-scores the fused
 *      candidates. On success the rerank order and scores replace the fused ones, and
 *      the default cut becomes {@link RERANKED_K} (the PRD's "top 3 after rerank").
 *   2. `c4_adaptive_context` on → `chooseK` over whichever scores survived step 1: start
 *      at 3, widen to the requested K only when there is no clear head.
 *   3. Both off → the first `requested` rows, exactly as before.
 *
 * Nothing here changes what a cache is keyed on: callers key on the REQUESTED limit, so
 * an adaptive cut never fragments the read-through cache.
 */
import { chooseK } from '@builderforce/agent-tools';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { rerankCandidates, type RerankDeps } from './reranker';

/** What the cut sends after a successful rerank when C4 is off. */
export const RERANKED_K = 3;

export interface ScoredCandidate<T> {
  row: T;
  /** Fused score, best first. */
  score: number;
}

export interface CutRecallInput<T> {
  env: unknown;
  tenantId: number;
  query: string;
  /** Fused candidates, best first. */
  ranked: ReadonlyArray<ScoredCandidate<T>>;
  /** The caller's K (default or asked) — never exceeded. */
  requested: number;
  /** Text the reranker reads for a candidate. */
  textOf: (row: T) => string;
  deps?: RerankDeps;
}

/** Rerank (C6) and size (C4) a fused recall. Off levers = `ranked.slice(0, requested)`. */
export async function cutRecall<T>(input: CutRecallInput<T>): Promise<T[]> {
  const { env, tenantId, requested } = input;
  let ranked = input.ranked;
  let reranked = false;

  if (input.query.trim() && ranked.length > 1 && isCostLeverOn(env, 'c6_rerank', tenantId)) {
    const scores = await rerankCandidates(env, input.query, ranked.map((c) => input.textOf(c.row)), input.deps);
    if (scores) {
      ranked = ranked
        .map((c, i) => ({ row: c.row, score: scores[i] ?? 0 }))
        .sort((a, b) => b.score - a.score);
      reranked = true;
    }
  }

  const adaptive = isCostLeverOn(env, 'c4_adaptive_context', tenantId);
  const k = adaptive
    ? chooseK({ requested, scores: ranked.map((c) => c.score) })
    : reranked
      ? Math.min(RERANKED_K, requested)
      : requested;
  return ranked.slice(0, k).map((c) => c.row);
}
