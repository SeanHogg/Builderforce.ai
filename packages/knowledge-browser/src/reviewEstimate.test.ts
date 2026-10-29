import { describe, expect, it, vi } from 'vitest';
import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import { estimateReview } from './reviewEstimate';

const plan = { rootId: 'r', estimatedModelCalls: 5 } as ReviewPlan;
const price = (perCallUsd: number | null, local = false) => ({ perCallUsd, local });

describe('estimateReview (the shared price model, mapped onto the chip)', () => {
  it("multiplies the plan's calls by the host price (sync or async)", async () => {
    expect(await estimateReview(plan, () => price(0.1), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0.5 });
    expect(await estimateReview(plan, async () => price(0), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0 });
  });

  it('passes the server’s estimate through as it comes (extra fields are not the chip’s business)', async () => {
    const judgeEstimate = async () => ({ perCallUsd: 0.002, model: 'anthropic/claude-haiku-5-5', local: false });
    expect(await estimateReview(plan, judgeEstimate, vi.fn())).toEqual({ modelCalls: 5, costUsd: 5 * 0.002 });
  });

  it('a local engine is free and flagged, whatever the plan size', async () => {
    expect(await estimateReview(plan, () => price(0, true), vi.fn())).toEqual({ modelCalls: 5, costUsd: 0, local: true });
  });

  it('gives calls only without a usable price', async () => {
    expect(await estimateReview(plan, undefined, vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => undefined, vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => price(null), vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => price(Number.NaN), vi.fn())).toEqual({ modelCalls: 5 });
    expect(await estimateReview(plan, () => price(-1), vi.fn())).toEqual({ modelCalls: 5 });
  });

  it('reports a price port that throws and still estimates the calls', async () => {
    const onDegraded = vi.fn();
    expect(await estimateReview(plan, () => { throw new Error('offline'); }, onDegraded)).toEqual({ modelCalls: 5 });
    expect(onDegraded).toHaveBeenCalledWith('review price', expect.any(Error), { rootId: 'r' });
  });
});
