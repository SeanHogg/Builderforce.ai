import { describe, expect, it } from 'vitest';
import { blendedQualityScore, qualityEvidence, ratingScore } from './modelQualityScore';
import { rankModelsForAction } from './LlmProxyService';

describe('ratingScore', () => {
  it('shrinks a thin record toward neutral so one lucky thumb cannot lead', () => {
    // The failure this prevents: a model tried once, liked once, scoring a perfect
    // 1.0 and outranking one with a long good record.
    expect(ratingScore(1, 0)).toBeCloseTo(0.667, 3);
    expect(ratingScore(0, 0)).toBe(0.5);
    expect(ratingScore(40, 3)).toBeGreaterThan(ratingScore(1, 0));
  });

  it('is bounded, monotonic, and treats a bad record as bad', () => {
    expect(ratingScore(0, 1)).toBeCloseTo(0.333, 3);
    expect(ratingScore(0, 50)).toBeLessThan(0.05);
    expect(ratingScore(50, 0)).toBeGreaterThan(0.95);
    expect(ratingScore(-5, -5)).toBe(0.5); // defensive: negatives clamp to zero
  });
});

describe('blendedQualityScore', () => {
  it('is exactly the outcome score when nobody has rated it', () => {
    expect(blendedQualityScore({ n: 12, avgScore: 0.8 })).toBe(0.8);
  });

  it('is pure human satisfaction when there is no run to score', () => {
    // Chat and canvas turns produce no run, so this is the ONLY evidence they give —
    // refusing to use it is what left the router blind to most model calls.
    expect(blendedQualityScore({ n: 0, avgScore: 0, ratedUp: 9, ratedDown: 0 }))
      .toBeCloseTo(ratingScore(9, 0), 6);
  });

  it('weights each side by how much evidence it actually has', () => {
    // 40 runs at 0.9 vs 2 thumbs-down: the runs dominate, but not entirely.
    const mostlyRuns = blendedQualityScore({ n: 40, avgScore: 0.9, ratedUp: 0, ratedDown: 2 });
    expect(mostlyRuns).toBeLessThan(0.9);
    expect(mostlyRuns).toBeGreaterThan(0.85);
    // Flip the evidence and the verdict flips with it.
    const mostlyThumbs = blendedQualityScore({ n: 2, avgScore: 0.9, ratedUp: 0, ratedDown: 40 });
    expect(mostlyThumbs).toBeLessThan(0.2);
  });
});

describe('qualityEvidence', () => {
  it('counts runs AND thumbs, so a well-rated chat model is not treated as cold', () => {
    expect(qualityEvidence({ n: 0, avgScore: 0, ratedUp: 7, ratedDown: 3 })).toBe(10);
    expect(qualityEvidence({ n: 5, avgScore: 0.5 })).toBe(5);
  });
});

describe('rankModelsForAction · ratings', () => {
  const pool = ['model-a', 'model-b', 'model-c'];

  it('lets human ratings alone promote a model past the curated order', () => {
    // model-b has NO cloud runs at all — only thumbs. Before ratings were counted as
    // evidence it could never clear the sample floor, so chat feedback changed nothing.
    const ranked = rankModelsForAction(pool, [
      { model: 'model-a', n: 10, avgScore: 0.4, avgCostMc: 100 },
      { model: 'model-b', n: 0, avgScore: 0, avgCostMc: 0, ratedUp: 12, ratedDown: 1 },
    ], { minSamples: 8 });
    expect(ranked[0]).toBe('model-b');
    expect(ranked).toHaveLength(pool.length);
    expect([...ranked].sort()).toEqual([...pool].sort()); // a permutation, never an invention
  });

  it('lets a bad rating record demote a model that merges well', () => {
    const ranked = rankModelsForAction(pool, [
      { model: 'model-a', n: 10, avgScore: 0.9, avgCostMc: 100, ratedUp: 0, ratedDown: 40 },
      { model: 'model-b', n: 10, avgScore: 0.7, avgCostMc: 100 },
    ], { minSamples: 8 });
    expect(ranked[0]).toBe('model-b');
  });

  it('keeps the curated order when nothing clears the evidence floor', () => {
    expect(rankModelsForAction(pool, [
      { model: 'model-c', n: 1, avgScore: 1, avgCostMc: 0, ratedUp: 2, ratedDown: 0 },
    ], { minSamples: 8 })).toEqual(pool);
  });
});
