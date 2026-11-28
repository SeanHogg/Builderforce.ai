import { fuseHybridArms } from '@seanhogg/builderforce-memory/retrieval';
import type { ScoredCandidate } from '../llm/retrievalK';

interface RankableMemory {
  id: string;
  importance: number;
  vectorScore: number;
}

/** Rank database candidates with the shared hybrid fusion. Neutral importance preserves the arm score. */
export function rankMemoryArms<T extends RankableMemory>(
  vector: readonly T[],
  text: readonly T[],
): Array<ScoredCandidate<T>> {
  const importanceWeight = (row: T) => 0.5 + (Number.isFinite(row.importance) ? row.importance : 0.5);
  return fuseHybridArms<T, T, ScoredCandidate<T>>({
    vector,
    text,
    vectorScoreOf: (row) => row.vectorScore * importanceWeight(row),
    textScoreOf: importanceWeight,
    merge: (row, score) => ({ row, score }),
  });
}
