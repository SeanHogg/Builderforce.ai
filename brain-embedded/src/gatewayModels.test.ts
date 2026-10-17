import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_GATEWAY_MODEL_OPTIONS,
  gatewayCanChooseModel,
  gatewayModelIdentity,
  gatewayPlanModels,
  invalidateGatewayModelOptions,
  loadGatewayModelOptions,
  type GatewayJsonRequest,
} from './gatewayModels';

const labels = { paidCostDetail: '{input} in · {output} out' };

function requestOf(routes: Record<string, unknown>): GatewayJsonRequest & ReturnType<typeof vi.fn> {
  return vi.fn(async (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected ${path}`);
    const body = routes[path];
    if (body instanceof Error) throw body;
    return body;
  }) as unknown as GatewayJsonRequest & ReturnType<typeof vi.fn>;
}

beforeEach(() => invalidateGatewayModelOptions());

describe('gateway model rules', () => {
  it('reads the plan pool from either payload shape', () => {
    expect(gatewayPlanModels({ models: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(gatewayPlanModels({ data: [{ model: 'a' }, { id: 'b' }, {}] })).toEqual(['a', 'b']);
  });

  it("honours the server's canChooseModel, and falls back to every grant that implies choice", () => {
    expect(gatewayCanChooseModel({ canChooseModel: false, effectivePlan: 'pro' })).toBe(false);
    expect(gatewayCanChooseModel({ effectivePlan: 'free' })).toBe(false);
    expect(gatewayCanChooseModel({ effectivePlan: 'pro' })).toBe(true);
    expect(gatewayCanChooseModel({ byo: { providers: ['anthropic'] } })).toBe(true);
    expect(gatewayCanChooseModel({ canUseFrontierModels: true })).toBe(true);
  });

  it('names the routing product from the plan or a premium override', () => {
    expect(gatewayModelIdentity({ effectivePlan: 'free', canChooseModel: false })).toEqual({ product: 'free', canChoose: false });
    expect(gatewayModelIdentity({ effectivePlan: 'free', premium: true, canChooseModel: true })).toEqual({ product: 'pro', canChoose: true });
  });
});

describe('loadGatewayModelOptions', () => {
  it("builds the menu's options and normalizes the pool rows for the selectors", async () => {
    const request = requestOf({
      '/llm/v1/models': {
        effectivePlan: 'pro',
        canChooseModel: true,
        canUsePremiumModels: true,
        data: [{ model: 'meta/llama' }],
        freeModels: ['meta/llama'],
        byo: { providers: ['anthropic'], models: [{ id: 'anthropic/claude', vendor: 'anthropic' }] },
      },
      '/api/llm/models': { models: [{ ref: 'tenant_model:ops', name: ' Ops ' }] },
      '/llm/v1/catalog': {
        data: [
          { id: 'x/pricey', pricing: { prompt: 0.00001, completion: 0.00002 }, supportedParameters: ['tools'] },
          { id: 'x/no-tools', pricing: { prompt: 0.000001, completion: 0 } },
          { id: 'x/pooled', pool: 'pro', pricing: { prompt: 0.000001, completion: 0 }, supportedParameters: ['tools'] },
        ],
      },
    });
    const result = await loadGatewayModelOptions(request, 'https://gw', labels);
    expect(result.identity).toEqual({ product: 'pro', canChoose: true });
    expect(result.surface.data).toEqual([{ id: 'meta/llama' }]);
    expect(result.options).toEqual({
      configured: [{ id: 'tenant_model:ops', label: 'Ops' }],
      byo: [{ id: 'anthropic/claude', vendor: 'anthropic' }],
      free: ['meta/llama'],
      plan: ['meta/llama'],
      paid: [{ id: 'x/pricey', cost: '$10.00 in · $20.00 out' }],
    });
  });

  it('reads once per key, and does not cache a failure', async () => {
    const ok = requestOf({ '/llm/v1/models': { models: ['a'] }, '/api/llm/models': { models: [] } });
    await loadGatewayModelOptions(ok, 'k', labels);
    await loadGatewayModelOptions(ok, 'k', labels);
    expect(ok.mock.calls.filter(([path]) => path === '/llm/v1/models')).toHaveLength(1);

    invalidateGatewayModelOptions();
    const failing = requestOf({ '/llm/v1/models': new Error('offline') });
    expect(await loadGatewayModelOptions(failing, 'k', labels)).toBe(EMPTY_GATEWAY_MODEL_OPTIONS);
    const retried = await loadGatewayModelOptions(ok, 'k', labels);
    expect(retried.options.plan).toEqual(['a']);
  });
});
