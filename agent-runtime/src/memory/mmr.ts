/**
 * Maximal Marginal Relevance (MMR) re-ranking algorithm.
 *
 * MMR balances relevance with diversity by iteratively selecting results
 * that maximize: λ * relevance - (1-λ) * max_similarity_to_selected
 *
 * @see Carbonell & Goldstein, "The Use of MMR, Diversity-Based Reranking" (1998)
 */

import { textMaximalMarginalRelevance } from "@seanhogg/builderforce-memory/retrieval";

export type MMRItem = {
  id: string;
  score: number;
  content: string;
};

export type MMRConfig = {
  /** Enable/disable MMR re-ranking. Default: false (opt-in) */
  enabled: boolean;
  /** Lambda parameter: 0 = max diversity, 1 = max relevance. Default: 0.7 */
  lambda: number;
};

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: false,
  lambda: 0.7,
};

/**
 * Re-rank items with Maximal Marginal Relevance when `config.enabled` — relevance is
 * each item's score normalised onto [0,1], diversity is Jaccard over word tokens, ties
 * go to the higher raw score. The selection itself is the memory package's
 * `textMaximalMarginalRelevance`, the same one every host ranks with.
 */
export function mmrRerank<T extends MMRItem>(items: T[], config: Partial<MMRConfig> = {}): T[] {
  const { enabled = DEFAULT_MMR_CONFIG.enabled, lambda = DEFAULT_MMR_CONFIG.lambda } = config;
  if (!enabled || items.length <= 1) {
    return [...items];
  }
  return textMaximalMarginalRelevance(items, lambda);
}

/**
 * Apply MMR re-ranking to hybrid search results.
 * Adapts the generic MMR function to work with the hybrid search result format.
 */
export function applyMMRToHybridResults<
  T extends { score: number; snippet: string; path: string; startLine: number },
>(results: T[], config: Partial<MMRConfig> = {}): T[] {
  if (results.length === 0) {
    return results;
  }

  // Create a map from ID to original item for type-safe retrieval
  const itemById = new Map<string, T>();

  // Create MMR items with unique IDs
  const mmrItems: MMRItem[] = results.map((r, index) => {
    const id = `${r.path}:${r.startLine}:${index}`;
    itemById.set(id, r);
    return {
      id,
      score: r.score,
      content: r.snippet,
    };
  });

  const reranked = mmrRerank(mmrItems, config);

  // Map back to original items using the ID
  return reranked.map((item) => itemById.get(item.id)!);
}
