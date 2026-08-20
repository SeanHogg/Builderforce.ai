import { describe, expect, it } from 'vitest';
import { creationObjectMutableFields, createDefaultCreationData } from '@/components/creation-canvas/creationObjectRegistry';
import { MODEL_OBJECT_SPECS } from './modelObjects';
import { specDerivedValues, specObjectSpec } from './specObjects';
import './specObjectSets';

/**
 * The point of this vocabulary is that a PRICE cannot be typed onto the card. These
 * tests assert that as a property of the declaration rather than of any one consumer:
 * the mutable list is derived from the spec, so a `projectedMonthlyCost` that reappears
 * in it is a regression the registry itself would have to have introduced.
 */
describe('the Models vocabulary', () => {
  const priced = {
    kind: 'llm',
    costPerMillionInput: 3,
    costPerMillionOutput: 15,
    tokensPerRequestIn: 2_000,
    tokensPerRequestOut: 500,
    monthlyRequests: 1_000_000,
  };

  it('registers llm as a spec kind so it has a derive hook at all', () => {
    expect(specObjectSpec('llm')?.group).toBe('Models');
    expect(MODEL_OBJECT_SPECS.map((spec) => spec.kind)).toEqual(['llm']);
  });

  it('derives the projection from the rate card and the volume', () => {
    const derived = specDerivedValues('llm', priced);
    // 2000 in @ $3/M = $0.006, 500 out @ $15/M = $0.0075 → $0.0135/request.
    expect(derived.costPerRequest).toBeCloseTo(0.0135, 6);
    expect(derived.projectedMonthlyCost).toBeCloseTo(13_500, 2);
    expect(derived.monthlyTokens).toBe(2_500_000_000);
    expect(derived.outputShare).toBe(56);
  });

  it('discounts input tokens only when a cache hit rate is set', () => {
    const cached = specDerivedValues('llm', { ...priced, cacheHitRate: 0.5 });
    // Input halves ($0.003), output is unchanged ($0.0075) → $0.0105.
    expect(cached.costPerRequest).toBeCloseTo(0.0105, 6);
    expect(cached.projectedMonthlyCost).toBeCloseTo(10_500, 2);
  });

  it('resolves nothing at all when an input is missing, rather than a confident zero', () => {
    const partial = specDerivedValues('llm', { kind: 'llm', costPerMillionInput: 3, monthlyRequests: 1_000_000 });
    expect(partial.projectedMonthlyCost).toBeUndefined();
    expect(partial.costPerRequest).toBeUndefined();
    expect(partial.monthlyTokens).toBeUndefined();
  });

  it('refuses to let the model author any computed number', () => {
    const mutable = creationObjectMutableFields('llm');
    expect(mutable).toContain('costPerMillionInput');
    expect(mutable).toContain('cacheHitRate');
    for (const computed of ['projectedMonthlyCost', 'costPerRequest', 'monthlyTokens', 'outputShare']) {
      expect(mutable).not.toContain(computed);
    }
  });

  it('still seeds a blank card the way the hand-declared entry did', () => {
    expect(createDefaultCreationData('llm')).toMatchObject({ kind: 'llm', status: 'Blueprint', model: 'gpt-4o' });
  });
});
