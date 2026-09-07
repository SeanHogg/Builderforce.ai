/**
 * Hybrid retrieval ranking — the ONE scoring formula both surfaces use to fuse a
 * semantic arm with a lexical arm.
 *
 * On-prem fuses `sqlite-vec` cosine similarity with FTS5/BM25; the cloud fuses a
 * pgvector cosine arm with an ILIKE arm. They are different engines answering the
 * same question, and before this they carried two copies of the weights and the
 * arithmetic — so "recall ranked the same way everywhere" was a claim nothing
 * enforced. It is now one function with one pair of defaults.
 *
 * Union semantics: a candidate found by only one arm scores 0 on the other rather
 * than being dropped, because "the lexical arm did not match" is evidence about
 * the query's wording, not about the candidate's relevance.
 *
 * Pure and dependency-free (this package's root is imported by the Worker).
 */

/** Weight on the semantic arm when a caller states none. */
export const DEFAULT_HYBRID_VECTOR_WEIGHT = 0.7;
/** Weight on the lexical arm when a caller states none. */
export const DEFAULT_HYBRID_TEXT_WEIGHT = 0.3;

export interface HybridWeights {
  vectorWeight: number;
  textWeight: number;
}

/**
 * Renormalise a pair of weights so it sums to 1 — a fused score is only comparable
 * across queries if the weights always sum the same. A degenerate pair (both zero
 * or non-finite) falls back to the defaults.
 *
 * The pair is a RATIO, so only the lower bound is clamped. Capping each weight at 1
 * first — which this did — silently rewrites the caller's intent: `(3, 1)` means
 * "three parts semantic to one part lexical" and came back as an even 0.5/0.5 split,
 * with nothing to indicate the request had been discarded. Normalisation is what
 * bounds the result; the clamp only has to reject a negative or non-finite weight.
 */
export function normalizeHybridWeights(vectorWeight?: number, textWeight?: number): HybridWeights {
  const clamp = (n: number | undefined, fallback: number): number =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : fallback;
  const v = clamp(vectorWeight, DEFAULT_HYBRID_VECTOR_WEIGHT);
  const t = clamp(textWeight, DEFAULT_HYBRID_TEXT_WEIGHT);
  const sum = v + t;
  if (sum <= 0) {
    return { vectorWeight: DEFAULT_HYBRID_VECTOR_WEIGHT, textWeight: DEFAULT_HYBRID_TEXT_WEIGHT };
  }
  return { vectorWeight: v / sum, textWeight: t / sum };
}

/** One candidate's per-arm scores, both already normalised to roughly [0,1]. */
export interface HybridArmScores {
  vectorScore?: number;
  textScore?: number;
}

/** The fused score for one candidate under the given (already normalised) weights. */
export function hybridScore(scores: HybridArmScores, weights: HybridWeights): number {
  const v = Number.isFinite(scores.vectorScore) ? (scores.vectorScore as number) : 0;
  const t = Number.isFinite(scores.textScore) ? (scores.textScore as number) : 0;
  return weights.vectorWeight * v + weights.textWeight * t;
}

/**
 * Map a BM25 rank (lower is better, unbounded) onto a (0,1] score so it can be
 * summed with a cosine similarity. A non-finite rank is treated as very poor
 * rather than as an error.
 */
export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Fuse two arms keyed by a caller-supplied id and return the candidates ordered
 * best-first. `merge` builds the output row from the winning payload of each id;
 * later duplicates of the same id keep the first payload seen (arm order decides).
 */
export function fuseHybridArms<TVector extends { id: string }, TText extends { id: string }, TOut>(params: {
  vector: readonly TVector[];
  text: readonly TText[];
  vectorScoreOf: (row: TVector) => number;
  textScoreOf: (row: TText) => number;
  merge: (row: TVector | TText, score: number) => TOut;
  weights?: Partial<HybridWeights>;
}): TOut[] {
  const weights = normalizeHybridWeights(params.weights?.vectorWeight, params.weights?.textWeight);
  const byId = new Map<string, { row: TVector | TText; scores: HybridArmScores }>();
  for (const row of params.vector) {
    byId.set(row.id, { row, scores: { vectorScore: params.vectorScoreOf(row), textScore: 0 } });
  }
  for (const row of params.text) {
    const existing = byId.get(row.id);
    if (existing) existing.scores.textScore = params.textScoreOf(row);
    else byId.set(row.id, { row, scores: { vectorScore: 0, textScore: params.textScoreOf(row) } });
  }
  return [...byId.values()]
    .map((entry) => ({ out: params.merge(entry.row, hybridScore(entry.scores, weights)), score: hybridScore(entry.scores, weights) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.out);
}
