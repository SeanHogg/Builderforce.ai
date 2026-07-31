import { describe, it, expect } from 'vitest';
import { EvermindLM } from '@seanhogg/builderforce-memory-engine';
import { embedTokens, cosineVec, packVec, unpackVec } from './evermindEmbed';

describe('embedTokens (SSM embedding over EvermindLM.forward().finalX)', () => {
  const lm = new EvermindLM({ vocabSize: 48, seed: 7 });

  it('returns a dModel-length, L2-normalised vector', () => {
    const v = embedTokens(lm, [1, 2, 3, 4, 5]);
    expect(v.length).toBe(lm.config.dModel);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
  });

  it('is deterministic for the same tokens', () => {
    const a = embedTokens(lm, [3, 1, 4, 1, 5]);
    const b = embedTokens(lm, [3, 1, 4, 1, 5]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(cosineVec(a, b)).toBeCloseTo(1, 5);
  });

  it('returns a zero vector for empty input', () => {
    const v = embedTokens(lm, []);
    expect(v.length).toBe(lm.config.dModel);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('a different token sequence generally yields a different embedding', () => {
    const a = embedTokens(lm, [1, 2, 3]);
    const b = embedTokens(lm, [40, 41, 42]);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('cosineVec', () => {
  it('is 1 for a vector with itself and clamps to [-1,1]', () => {
    const v = Float32Array.from([0.6, 0.8]); // already unit-length
    expect(cosineVec(v, v)).toBeCloseTo(1, 6);
    expect(cosineVec(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
  });
});

describe('packVec / unpackVec', () => {
  it('round-trips a Float32 embedding losslessly', () => {
    const v = Float32Array.from([0.1, -0.25, 0.5, 0, 0.999, -1]);
    const back = unpackVec(packVec(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it('returns an empty vector for malformed base64', () => {
    expect(unpackVec('not-base64-!!!').length).toBe(0);
  });
});
