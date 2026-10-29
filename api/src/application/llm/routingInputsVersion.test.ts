/**
 * routingInputsVersion changes when anything the gateway routes by does — including a connected
 * provider's selected-models list, which has no row-level stamp of its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  rows: vi.fn(async () => [{ id: 'k1', provider: 'anthropic', keyEnc: null, authType: 'api_key', priority: 1 }]),
  plan: vi.fn(async () => ({ effectivePlan: 'pro', premiumOverride: false })),
  selections: vi.fn(async (): Promise<Record<string, string[]>> => ({})),
}));
vi.mock('./tenantProviderRows', () => ({ loadTenantProviderRows: mocks.rows }));
vi.mock('../tenant/tenantPlanSnapshot', () => ({ resolveTenantPlan: mocks.plan }));
vi.mock('./providerModelSelection', () => ({ listProviderModelSelections: mocks.selections }));

import { routingInputsVersion } from './routingInputsVersion';

const env = {} as Env;
const version = () => routingInputsVersion(env, 7);

describe('routingInputsVersion', () => {
  beforeEach(() => { mocks.selections.mockResolvedValue({}); });

  it('is stable for unchanged inputs', async () => {
    expect(await version()).toBe(await version());
  });

  it('changes when a provider’s selected models change', async () => {
    const none = await version();
    mocks.selections.mockResolvedValue({ anthropic: ['claude-haiku-5-5'] });
    const picked = await version();
    mocks.selections.mockResolvedValue({ anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5'] });
    const more = await version();
    expect(new Set([none, picked, more]).size).toBe(3);
  });

  it('changes when the lead model changes order (position 0 leads, the rest fail over)', async () => {
    mocks.selections.mockResolvedValue({ anthropic: ['a', 'b'] });
    const first = await version();
    mocks.selections.mockResolvedValue({ anthropic: ['b', 'a'] });
    expect(await version()).not.toBe(first);
  });

  it('does not depend on the order providers are listed in, and treats an empty selection as none', async () => {
    mocks.selections.mockResolvedValue({ openai: ['x'], anthropic: ['y'] });
    const one = await version();
    mocks.selections.mockResolvedValue({ anthropic: ['y'], openai: ['x'], xai: [] });
    expect(await version()).toBe(one);
  });

  it('still versions when the selection read fails (advisory: it degrades to none)', async () => {
    const none = await version();
    mocks.selections.mockRejectedValueOnce(new Error('offline'));
    expect(await version()).toBe(none);
  });

  it('changes with the plan', async () => {
    const pro = await version();
    mocks.plan.mockResolvedValueOnce({ effectivePlan: 'free', premiumOverride: false });
    expect(await version()).not.toBe(pro);
  });

  it('changes with the premium override (the gateway routes the premium pool by it)', async () => {
    const plain = await version();
    mocks.plan.mockResolvedValueOnce({ effectivePlan: 'pro', premiumOverride: true });
    expect(await version()).not.toBe(plain);
  });
});
