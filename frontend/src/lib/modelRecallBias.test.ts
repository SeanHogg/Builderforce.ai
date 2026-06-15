import { describe, expect, it } from 'vitest';
import { embedTask, computeModelRecallBias, hasRecallCapability } from './modelRecallBias';

describe('embedTask', () => {
  it('is deterministic and L2-normalized', () => {
    const a = embedTask('add an index to the orders table');
    const b = embedTask('add an index to the orders table');
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('similar texts embed closer than dissimilar ones (cosine)', () => {
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    const sql1 = embedTask('add a database index to the orders table for faster queries');
    const sql2 = embedTask('create an index on the orders table to speed up the query');
    const ui = embedTask('restyle the dashboard header with a new gradient background');
    expect(dot(sql1, sql2)).toBeGreaterThan(dot(sql1, ui));
  });

  it('empty text yields a zero vector (no NaN)', () => {
    const v = embedTask('');
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe('computeModelRecallBias capability gate', () => {
  it('returns an empty map (no-op) when WebGPU is absent — headless/unsupported safety', async () => {
    // jsdom has no navigator.gpu, so the capability gate must fail closed.
    expect(hasRecallCapability()).toBe(false);
    expect(await computeModelRecallBias('any task text')).toEqual({});
  });

  it('returns an empty map for blank task text', async () => {
    expect(await computeModelRecallBias('   ')).toEqual({});
  });
});
