import { calculateTemporalDecayMultiplier, fuseHybridArms } from '@seanhogg/builderforce-memory/retrieval';
import type { ScoredCandidate } from '../llm/retrievalK';

interface RankableMemory {
  id: string;
  importance: number;
  vectorScore: number;
  updatedAt: Date | null;
}

/** Rank database candidates with the shared hybrid fusion. Apply importance and a 90-day recency half-life. */
export function rankMemoryArms<T extends RankableMemory>(
  vector: readonly T[],
  text: readonly T[],
): Array<ScoredCandidate<T>> {
  const now = Date.now();
  const weight = (row: T) => {
    const importance = Number.isFinite(row.importance) ? row.importance : 0.5;
    const ageInDays = row.updatedAt ? (now - row.updatedAt.getTime()) / 86_400_000 : 0;
    return (0.5 + importance) * calculateTemporalDecayMultiplier({ ageInDays, halfLifeDays: 90 });
  };
  return fuseHybridArms<T, T, ScoredCandidate<T>>({
    vector,
    text,
    vectorScoreOf: (row) => row.vectorScore * weight(row),
    textScoreOf: weight,
    merge: (row, score) => ({ row, score }),
  });
}
