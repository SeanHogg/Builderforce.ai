import { describe, expect, it } from 'vitest';
import { foldDecompositionCensus } from './decompositionCensus';

/**
 * The thresholds are the whole point of this census: one heuristic Epic is a
 * coincidence, a RUN of them is a model-availability incident. Getting that line
 * wrong in either direction is the failure — too eager and people learn to ignore
 * the flag, too lax and the outage stays invisible.
 */
describe('foldDecompositionCensus', () => {
  it('counts nothing as nothing rather than dividing by zero', () => {
    const census = foldDecompositionCensus([]);
    expect(census.decomposed).toBe(0);
    expect(census.heuristicPct).toBe(0);
    expect(census.degraded).toBe(false);
  });

  it('separates the recorded sources from the un-recorded ones', () => {
    const census = foldDecompositionCensus([
      { source: 'llm', n: 6 },
      { source: 'heuristic', n: 2 },
      { source: 'manual', n: 2 },
      { source: null, n: 5 },
    ]);
    expect(census).toMatchObject({ llm: 6, heuristic: 2, manual: 2, unrecorded: 5, decomposed: 10 });
    expect(census.heuristicPct).toBe(20);
  });

  it('does NOT call a single fallback an incident', () => {
    const census = foldDecompositionCensus([{ source: 'llm', n: 1 }, { source: 'heuristic', n: 2 }]);
    // 67% heuristic, but only two of them — below the count floor.
    expect(census.heuristicPct).toBe(67);
    expect(census.degraded).toBe(false);
  });

  it('does NOT call a small heuristic share an incident on a big board', () => {
    const census = foldDecompositionCensus([{ source: 'llm', n: 40 }, { source: 'heuristic', n: 4 }]);
    expect(census.degraded).toBe(false);
  });

  it('calls a RUN of heuristic decompositions what it is', () => {
    const census = foldDecompositionCensus([{ source: 'llm', n: 2 }, { source: 'heuristic', n: 6 }]);
    expect(census.heuristicPct).toBe(75);
    expect(census.degraded).toBe(true);
  });

  it('ignores an unknown source rather than mis-attributing it', () => {
    const census = foldDecompositionCensus([{ source: 'something-else', n: 3 }]);
    expect(census.unrecorded).toBe(3);
    expect(census.decomposed).toBe(0);
  });
});
