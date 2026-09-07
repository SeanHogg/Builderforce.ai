import { describe, expect, it } from "vitest";
import {
  DEFAULT_HYBRID_TEXT_WEIGHT,
  DEFAULT_HYBRID_VECTOR_WEIGHT,
  bm25RankToScore,
  fuseHybridArms,
  hybridScore,
  normalizeHybridWeights,
} from "./hybrid-rank.js";

/**
 * The shared fusion both retrieval surfaces rank with. These pin the arithmetic
 * itself, because the cloud and on-prem arms are different engines and the ONLY
 * thing making their orderings comparable is that this formula is the same.
 */
describe("normalizeHybridWeights", () => {
  it("defaults to the documented 0.7 / 0.3 split", () => {
    expect(normalizeHybridWeights()).toEqual({
      vectorWeight: DEFAULT_HYBRID_VECTOR_WEIGHT,
      textWeight: DEFAULT_HYBRID_TEXT_WEIGHT,
    });
  });

  it("renormalises a pair that does not sum to one", () => {
    expect(normalizeHybridWeights(3, 1)).toEqual({ vectorWeight: 0.75, textWeight: 0.25 });
  });

  it("falls back to the defaults for a degenerate pair", () => {
    expect(normalizeHybridWeights(0, 0)).toEqual({ vectorWeight: 0.7, textWeight: 0.3 });
    expect(normalizeHybridWeights(Number.NaN, undefined)).toEqual({ vectorWeight: 0.7, textWeight: 0.3 });
  });
});

describe("hybridScore", () => {
  it("weights the two arms and treats a missing arm as zero, not as a drop", () => {
    const w = normalizeHybridWeights();
    expect(hybridScore({ vectorScore: 1, textScore: 1 }, w)).toBeCloseTo(1);
    expect(hybridScore({ vectorScore: 1 }, w)).toBeCloseTo(0.7);
    expect(hybridScore({ textScore: 1 }, w)).toBeCloseTo(0.3);
  });
});

describe("bm25RankToScore", () => {
  it("maps a better (lower) rank to a higher score inside (0,1]", () => {
    expect(bm25RankToScore(0)).toBe(1);
    expect(bm25RankToScore(1)).toBe(0.5);
    expect(bm25RankToScore(1)).toBeGreaterThan(bm25RankToScore(9));
    expect(bm25RankToScore(Number.NaN)).toBeCloseTo(1 / 1000);
  });
});

describe("fuseHybridArms", () => {
  it("unions both arms, scores each once, and orders best-first", () => {
    const out = fuseHybridArms({
      vector: [{ id: 'a', text: 'semantic only' }, { id: 'b', text: 'both' }],
      text: [{ id: 'b', text: 'both' }, { id: 'c', text: 'lexical only' }],
      vectorScoreOf: (r) => (r.id === 'b' ? 0.8 : 0.9),
      textScoreOf: (r) => (r.id === 'b' ? 0.9 : 1),
      merge: (row, score) => ({ id: row.id, score }),
    });
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    // b: .7*.8 + .3*.9 = .83 · a: .7*.9 = .63 · c: .3*1 = .3
    expect(out[0].score).toBeCloseTo(0.83);
    expect(out[2].score).toBeCloseTo(0.3);
  });

  it("keeps a candidate found by only one arm", () => {
    const out = fuseHybridArms({
      vector: [],
      text: [{ id: 'only' }],
      vectorScoreOf: () => 0,
      textScoreOf: () => 0.5,
      merge: (row, score) => ({ id: row.id, score }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeCloseTo(0.15);
  });
});
