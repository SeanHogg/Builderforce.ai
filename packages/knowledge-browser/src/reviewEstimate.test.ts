import { describe, expect, it, vi } from 'vitest';
import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import { estimateReview } from './reviewEstimate';

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
});
