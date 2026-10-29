/**
 * The review's cost estimate (PRD 38 §3.1): one judged section priced on the route the real
 * call takes — priced, local, free, unknown — and its cached composition.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AVG_SECTION_BYTES } from '@seanhogg/builderforce-memory/knowledge';
import { perMillionToPerToken, estimateCostUsd } from '@builderforce/model-catalog';
import { KNOWLEDGE_EXTRACT_SYSTEM } from '@builderforce/agent-tools';

const mocks = vi.hoisted(() => ({
  previewRoute: vi.fn(async (_body: unknown): Promise<string[]> => ['anthropic/claude-haiku-5-5']),
  proxyFor: vi.fn(),
  priceBook: vi.fn(),
  version: vi.fn(async () => 'v1'),
}));
vi.mock('../llm/tenantProxy', () => ({ tenantProxyForPlan: mocks.proxyFor }));
vi.mock('../llm/catalogView', () => ({ loadPriceBook: mocks.priceBook }));
vi.mock('../llm/routingInputsVersion', () => ({ routingInputsVersion: mocks.version }));

import {
  JUDGE_TYPICAL_OUTPUT_TOKENS, estimateJudgeCost, sampleExtractRequest, sampleInputTokens, type JudgeCostPorts,
} from './estimateJudgeCost';
import { judgeCostCacheKey, judgeCostFor } from './judgeCostEstimate';

const PRICE = { input: perMillionToPerToken(1), output: perMillionToPerToken(5) };

function ports(over: Partial<JudgeCostPorts> = {}): JudgeCostPorts {
  return { route: async () => ['anthropic/claude-haiku-5-5'], price: () => PRICE, isLocal: () => false, ...over };
}

describe('estimateJudgeCost', () => {
  it('measures the input from the real extract prompt and an average section', () => {
    const body = sampleExtractRequest();
    const system = body.messages.find((m) => m.role === 'system')?.content as string;
    expect(system).toBe(KNOWLEDGE_EXTRACT_SYSTEM);
    expect(body.useCase).toBe('knowledge_judge');
    expect(sampleInputTokens(body)).toBeGreaterThan(Math.ceil((AVG_SECTION_BYTES + KNOWLEDGE_EXTRACT_SYSTEM.length) / 4));
  });

  it('prices one section at the routed model’s rate: input tokens + the typical output', async () => {
    const out = await estimateJudgeCost(ports());
    expect(out).toEqual({
      perCallUsd: estimateCostUsd(PRICE, sampleInputTokens(sampleExtractRequest()), JUDGE_TYPICAL_OUTPUT_TOKENS),
      model: 'anthropic/claude-haiku-5-5',
      local: false,
    });
    expect(out.perCallUsd).toBeGreaterThan(0);
  });

  it('routes the real request shape (the extract prompt, structured JSON output)', async () => {
    const route = vi.fn(async () => ['m']);
    await estimateJudgeCost(ports({ route }));
    expect(route).toHaveBeenCalledWith(expect.objectContaining({ useCase: 'knowledge_judge', response_format: { type: 'json_object' } }));
  });

  it('a model on the tenant’s own machine is local and free', async () => {
    const price = vi.fn(() => PRICE);
    expect(await estimateJudgeCost(ports({ route: async () => ['ollama/llama3'], isLocal: () => true, price }))).toEqual({ perCallUsd: 0, model: 'ollama/llama3', local: true });
    expect(price).not.toHaveBeenCalled();
  });

  it('a free-priced cloud model costs 0 but is not local', async () => {
    expect(await estimateJudgeCost(ports({ price: () => ({ input: 0, output: 0 }) }))).toEqual({ perCallUsd: 0, model: 'anthropic/claude-haiku-5-5', local: false });
  });

  it('an unpriced model answers null, naming the model', async () => {
    expect(await estimateJudgeCost(ports({ price: () => undefined }))).toEqual({ perCallUsd: null, model: 'anthropic/claude-haiku-5-5', local: false });
  });

  it('nothing routable answers null with no model', async () => {
    expect(await estimateJudgeCost(ports({ route: async () => [] }))).toEqual({ perCallUsd: null, model: null, local: false });
  });
});

describe('judgeCostFor (cached composition)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewRoute.mockResolvedValue(['anthropic/claude-haiku-5-5']);
    mocks.proxyFor.mockResolvedValue({ proxy: { previewRoute: mocks.previewRoute } });
    mocks.priceBook.mockResolvedValue({ priceOf: () => PRICE, listPriceOf: () => PRICE });
    mocks.version.mockResolvedValue('v1');
  });

  it('routes through the tenant’s proxy once, then serves the cached estimate', async () => {
    const env = {} as never;
    const first = await judgeCostFor(env, 9001, 1);
    const second = await judgeCostFor(env, 9001, 1);
    expect(second).toEqual(first);
    expect(first.perCallUsd).toBeGreaterThan(0);
    expect(mocks.previewRoute).toHaveBeenCalledTimes(1);
  });

  it('a changed routing version, tenant or project is a new key (recomputed)', async () => {
    const env = {} as never;
    await judgeCostFor(env, 9002, 1);
    mocks.version.mockResolvedValue('v2');
    await judgeCostFor(env, 9002, 1);
    await judgeCostFor(env, 9003, 1);
    await judgeCostFor(env, 9002, 2);
    expect(mocks.previewRoute).toHaveBeenCalledTimes(4);
    expect(judgeCostCacheKey(9002, 1, 'v1')).not.toBe(judgeCostCacheKey(9002, 1, 'v2'));
    expect(judgeCostCacheKey(9002, 1, 'v1')).not.toBe(judgeCostCacheKey(9003, 1, 'v1'));
  });
});
