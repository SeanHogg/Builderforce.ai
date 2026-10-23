/**
 * The cache steps of `completeChat`: B3 single-flight (identical cacheable requests in
 * flight share ONE dispatch) and B2 semantic cache wiring (lookup before dispatch,
 * store after the primary path succeeds), each behind its cost lever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchStrict: vi.fn(),
  readHit: vi.fn(),
  storeExact: vi.fn(),
  plan: vi.fn(),
  lookup: vi.fn(),
  storeSemantic: vi.fn(),
}));

vi.mock('./proxyStrictPin', () => ({ dispatchStrict: mocks.dispatchStrict }));
vi.mock('./proxyResponseCache', () => ({
  responseCacheKeyFor: async (_body: unknown, grant: { tenantId: number } | undefined) => (grant ? `respcache:t${grant.tenantId}:k` : null),
  readResponseCacheHit: mocks.readHit,
  storeInResponseCache: mocks.storeExact,
}));
vi.mock('./semanticChatCache', () => ({
  planSemanticChat: mocks.plan,
  lookupSemanticChat: mocks.lookup,
  storeSemanticChat: mocks.storeSemantic,
}));

import { completeChat } from './proxyCompletion';
import type { ProxyRuntime } from './proxyConfig';
import type { ChatCompletionRequest, ProxyResult } from './proxyTypes';
import { inFlightCompletions } from './proxySingleFlight';

const body = {
  model: 'openai/gpt-test',
  modelStrict: true,
  useCase: 'classification',
  temperature: 0,
  messages: [{ role: 'user', content: 'Classify: refund request' }],
} as unknown as ChatCompletionRequest;

function upstream(): ProxyResult {
  return {
    response: new Response(JSON.stringify({ choices: [{ message: { content: 'billing' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: 'openai/gpt-test',
    resolvedVendor: 'openrouter',
    retries: 0,
    failovers: [],
    usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
  } as ProxyResult;
}

function runtime(env: Record<string, unknown>): ProxyRuntime {
  return {
    cfg: { env } as never,
    funding: { isTenantFunded: () => false } as never,
    dispatcher: {} as never,
    finalize: (result, traceId, _startedAt, _chain, outcome) => ({ ...result, traceId, ...(outcome ? { outcome } : {}) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHit.mockResolvedValue(null);
  mocks.storeExact.mockResolvedValue(undefined);
  mocks.plan.mockResolvedValue(null);
  mocks.lookup.mockResolvedValue(null);
  mocks.storeSemantic.mockResolvedValue(undefined);
});

describe('B3 single-flight', () => {
  it('5 concurrent identical cacheable calls → 1 dispatch; followers are cache hits with readable bodies', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mocks.dispatchStrict.mockImplementation(async () => { await gate; return upstream(); });
    const rt = runtime({ COST_LEVER_B2_SEMANTIC_CACHE: 'off' });

    const calls = Array.from({ length: 5 }, (_, i) =>
      completeChat(rt, body, undefined, `trace-${i}`, undefined, { responseCache: { tenantId: 77 } }));
    // Let every caller get past the cache read and join the flight.
    await new Promise((r) => setTimeout(r, 0));
    expect(inFlightCompletions()).toBe(1);
    release();
    const results = await Promise.all(calls);

    expect(mocks.dispatchStrict).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.outcome === 'response_cache_hit')).toHaveLength(4);
    // Every caller can read its own body — a Response body is read once.
    const texts = (await Promise.all(results.map((r) => r.response.json()))) as Array<{ choices: Array<{ message: { content: string } }> }>;
    for (const t of texts) expect(t.choices[0]?.message.content).toBe('billing');
    // Followers are never metered as spend: no `usage`, the leader's as `cachedUsage`.
    for (const r of results.filter((x) => x.outcome === 'response_cache_hit')) {
      expect(r.usage).toBeUndefined();
      expect(r.cachedUsage?.promptTokens).toBe(10);
    }
    // Each follower keeps its own trace id.
    expect(new Set(results.map((r) => r.traceId)).size).toBe(5);
    expect(inFlightCompletions()).toBe(0);
  });

  it('lever off → every call dispatches (today\'s behaviour)', async () => {
    mocks.dispatchStrict.mockImplementation(async () => upstream());
    const rt = runtime({ COST_LEVER_B3_SINGLE_FLIGHT: 'off', COST_LEVER_B2_SEMANTIC_CACHE: 'off' });
    await Promise.all(Array.from({ length: 3 }, () =>
      completeChat(rt, body, undefined, undefined, undefined, { responseCache: { tenantId: 77 } })));
    expect(mocks.dispatchStrict).toHaveBeenCalledTimes(3);
  });

  it('never coalesces a request the caller did not grant caching for', async () => {
    mocks.dispatchStrict.mockImplementation(async () => upstream());
    const rt = runtime({});
    await Promise.all(Array.from({ length: 3 }, () => completeChat(rt, body)));
    expect(mocks.dispatchStrict).toHaveBeenCalledTimes(3);
  });
});

describe('B2 semantic cache wiring', () => {
  it('a semantic hit is served before any dispatch, as a cache hit', async () => {
    mocks.plan.mockResolvedValue({ tenantId: 77 });
    mocks.lookup.mockResolvedValue({ ...upstream(), outcome: 'response_cache_hit', usage: undefined });
    const rt = runtime({ COST_LEVER_B2_SEMANTIC_CACHE: 'on' });
    const result = await completeChat(rt, body, undefined, 't', undefined, { responseCache: { tenantId: 77 } });
    expect(result.outcome).toBe('response_cache_hit');
    expect(mocks.dispatchStrict).not.toHaveBeenCalled();
  });

  it('lever off → no plan is made, so no embedding is computed', async () => {
    mocks.dispatchStrict.mockImplementation(async () => upstream());
    const rt = runtime({ COST_LEVER_B2_SEMANTIC_CACHE: 'off' });
    await completeChat(rt, body, undefined, 't', undefined, { responseCache: { tenantId: 77 } });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.storeSemantic).not.toHaveBeenCalled();
  });
});
