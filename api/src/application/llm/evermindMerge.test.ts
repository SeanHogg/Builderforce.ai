import { describe, it, expect } from 'vitest';
import {
  appendCrcTrailer,
  verifyCrcTrailer,
  diffCheckpoints,
} from '@seanhogg/builderforce-memory-engine';
import { mergeCheckpointDiffs } from './evermindMerge';

/** Build a CRC-trailed checkpoint from raw f32 values (mirrors exportWeights). */
function ckpt(values: number[]): ArrayBuffer {
  return appendCrcTrailer(Float32Array.from(values).buffer);
}

/** Read a merged checkpoint back into a plain number[] (CRC stripped). */
function readback(buf: ArrayBuffer): number[] {
  const { body } = verifyCrcTrailer(buf);
  return Array.from(new Float32Array(body));
}

describe('mergeCheckpointDiffs (FedAvg over contributors)', () => {
  const base = ckpt([0, 0, 0, 0, 0, 0]);

  it('averages overlapping rows and keeps single-toucher rows', () => {
    const diffA = diffCheckpoints(base, ckpt([1, 1, 0, 0, 0, 0])); // touches 0,1
    const diffB = diffCheckpoints(base, ckpt([0, 3, 3, 0, 0, 0])); // touches 1,2

    const { checkpoint, mergedRows, contributors } = mergeCheckpointDiffs(base, [diffA, diffB]);
    const out = readback(checkpoint);

    expect(contributors).toBe(2);
    expect(mergedRows).toBe(3); // elements 0,1,2
    expect(out[0]).toBeCloseTo(1, 6);   // only A
    expect(out[1]).toBeCloseTo(2, 6);   // mean(1,3)
    expect(out[2]).toBeCloseTo(3, 6);   // only B
    expect(out[3]).toBeCloseTo(0, 6);   // untouched stays base
  });

  it('honors per-contributor sample weights', () => {
    const diffA = diffCheckpoints(base, ckpt([1, 1, 0, 0, 0, 0]));
    const diffB = diffCheckpoints(base, ckpt([0, 3, 3, 0, 0, 0]));

    const { checkpoint } = mergeCheckpointDiffs(base, [diffA, diffB], [1, 3]);
    const out = readback(checkpoint);

    expect(out[0]).toBeCloseTo(1, 6);           // only A (weight 1)
    expect(out[1]).toBeCloseTo((1 * 1 + 3 * 3) / 4, 6); // weighted mean = 2.5
    expect(out[2]).toBeCloseTo(3, 6);           // only B
  });

  it('returns the base unchanged for an empty contributor set', () => {
    const res = mergeCheckpointDiffs(base, []);
    expect(res.contributors).toBe(0);
    expect(res.mergedRows).toBe(0);
    expect(readback(res.checkpoint)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ignores zero/negative-weight contributors', () => {
    const diffA = diffCheckpoints(base, ckpt([2, 0, 0, 0, 0, 0]));
    const diffB = diffCheckpoints(base, ckpt([0, 9, 0, 0, 0, 0]));
    const { checkpoint } = mergeCheckpointDiffs(base, [diffA, diffB], [1, 0]);
    const out = readback(checkpoint);
    expect(out[0]).toBeCloseTo(2, 6); // A applied
    expect(out[1]).toBeCloseTo(0, 6); // B ignored (weight 0) → stays base
  });

  it('reports deltaNorm = L2 of the actual weight movement base→merged', () => {
    const diffA = diffCheckpoints(base, ckpt([1, 1, 0, 0, 0, 0])); // touches 0,1
    const diffB = diffCheckpoints(base, ckpt([0, 3, 3, 0, 0, 0])); // touches 1,2
    // Merged from an all-zero base = [1, 2, 3, 0, 0, 0]; movement L2 = √(1+4+9).
    const { deltaNorm } = mergeCheckpointDiffs(base, [diffA, diffB]);
    expect(deltaNorm).toBeCloseTo(Math.sqrt(1 + 4 + 9), 5);
    // No contributors → no movement.
    expect(mergeCheckpointDiffs(base, []).deltaNorm).toBe(0);
  });

  it('is reproducible (deterministic merge of the same inputs)', () => {
    const dA = diffCheckpoints(base, ckpt([1, 2, 0, 0, 0, 0]));
    const dB = diffCheckpoints(base, ckpt([0, 4, 5, 0, 0, 0]));
    const r1 = readback(mergeCheckpointDiffs(base, [dA, dB]).checkpoint);
    const r2 = readback(mergeCheckpointDiffs(base, [dA, dB]).checkpoint);
    expect(r1).toEqual(r2);
  });
});
