import { describe, expect, it, vi } from 'vitest';
import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import { clientCallPrice, estimateReview } from './reviewEstimate';

const plan = { rootId: 'r', estimatedModelCalls: 5 } as ReviewPlan;

describe('estimateReview', () => {
  it("multiplies the plan's calls by the host price (sync or async)", async () => {
    expect(await estimateReview(plan, () => 0.1, vi.fn())).toEqual({ modelCalls: 5, costUsd: 0.5 });
    expect(await estimateReview(plan, async () => 0, vi.fn())).toEqual({ modelCalls: 5, costUsd: 0 });
  });

  it('gives calls only without a usable price', async () => {
    expect(await estimateReview(plan, undefined, vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => undefined, vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => Number.NaN, vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => -1, vi.fn())).toEqual({ modelCalls: 5 });
  });

  it('reports a price port that throws and still estimates the calls', async () => {
    const onDegraded = vi.fn();
    expect(await estimateReview(plan, () => { throw new Error('offline'); }, onDegraded)).toEqual({ modelCalls: 5 });
    expect(onDegraded).toHaveBeenCalledWith('review price', expect.any(Error), { rootId: 'r' });
  });

  it('a local call is free and flagged, whatever the plan size', async () => {
    expect(await estimateReview(plan, () => ({ local: true }), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0, local: true });
  });
});

describe('clientCallPrice (the server prices the call)', () => {
  const client = (estimate: { perCallUsd: number | null; model: string | null; local: boolean }) => ({ judgeEstimate: vi.fn(async () => estimate) });

  it('passes the server’s per-call USD through', async () => {
    expect(await estimateReview(plan, clientCallPrice(client({ perCallUsd: 0.002, model: 'm', local: false })), vi.fn())).toEqual({ modelCalls: 5, costUsd: 5 * 0.002 });
  });

  it('a free (0) cloud model is a $0 cost, not "after routing"', async () => {
    expect(await estimateReview(plan, clientCallPrice(client({ perCallUsd: 0, model: 'm', local: false })), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0 });
  });

  it('a local engine is the local note', async () => {
    expect(await estimateReview(plan, clientCallPrice(client({ perCallUsd: 0, model: 'ollama/x', local: true })), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0, local: true });
  });

  it('an unknown price keeps "cost shown after routing" (calls only)', async () => {
    expect(await estimateReview(plan, clientCallPrice(client({ perCallUsd: null, model: 'm', local: false })), vi.fn())).toEqual({ modelCalls: 5 });
  });

  it('a failing estimate call is reported and degrades to calls only', async () => {
    const onDegraded = vi.fn();
    const failing = { judgeEstimate: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await estimateReview(plan, clientCallPrice(failing), onDegraded)).toEqual({ modelCalls: 5 });
    expect(onDegraded).toHaveBeenCalledWith('review price', expect.any(Error), { rootId: 'r' });
  });
});
