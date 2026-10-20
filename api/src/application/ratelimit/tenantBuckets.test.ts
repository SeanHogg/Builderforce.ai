/**
 * The chat-turn persist is exempt at the door, but its fan-out (directed agent
 * replies + mention notifies) is spent against `${tenantId}:dispatch` — in units,
 * in one round-trip, admitted only when the whole cost fits.
 */
import { describe, expect, it, vi } from 'vitest';

const resolveTenantEffectivePlan = vi.fn();
vi.mock('../tenant/tenantPlanSnapshot', () => ({
  resolveTenantEffectivePlan: (...a: unknown[]) => resolveTenantEffectivePlan(...a),
}));

import { consumeDispatchBudget, dispatchBucketKey } from './tenantBuckets';

function fakeLimiter() {
  const calls: { key: string; limit: number; cost: number }[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (req: Request) => {
        const body = (await req.json()) as { limit: number; cost: number };
        calls.push({ key: String(id), limit: body.limit, cost: body.cost });
        return Response.json({ allowed: body.cost <= 2, current: 0, limit: body.limit, resetAt: new Date(Date.now() + 30_000).toISOString() });
      },
    }),
  };
  return { env: { TENANT_RATE_LIMITER: ns } as never, calls };
}

describe('consumeDispatchBudget', () => {
  it('spends the whole fan-out against the dispatch bucket at plan rpm', async () => {
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const { env, calls } = fakeLimiter();
    const verdict = await consumeDispatchBudget(env, 41, 2);
    expect(verdict?.allowed).toBe(true);
    expect(calls).toEqual([{ key: dispatchBucketKey(41), limit: 300, cost: 2 }]);
    expect(dispatchBucketKey(41)).toBe('41:dispatch');
  });

  it('reports a fan-out that does not fit as not allowed', async () => {
    resolveTenantEffectivePlan.mockResolvedValue('pro');
    const { env } = fakeLimiter();
    const verdict = await consumeDispatchBudget(env, 41, 5);
    expect(verdict?.allowed).toBe(false);
    expect(verdict?.limit).toBe(1200);
  });

  it('spends nothing for a turn with no fan-out', async () => {
    const { env, calls } = fakeLimiter();
    expect(await consumeDispatchBudget(env, 41, 0)).toBeNull();
    expect(calls).toEqual([]);
  });
});
