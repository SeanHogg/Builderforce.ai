/**
 * B2 — the gateway's semantic step: what may be answered from a paraphrase, the scope
 * it is partitioned by, the grounds that make a match stale, the near-miss log, and
 * the 7-day TTL on every KV write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import {
  groundsHold,
  lookupSemanticChat,
  modelClassOf,
  planSemanticChat,
  splitSemanticQuery,
  storeSemanticChat,
  type ResponseCacheGrant,
  type SemanticChatDeps,
} from './semanticChatCache';
import { SEMANTIC_CACHE_TTL_SECONDS } from './semanticCache';
import type { ChatCompletionRequest, ProxyEnv, ProxyResult } from './proxyTypes';

function fakeKV() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; opts: unknown }> = [];
  return {
    store,
    puts,
    async get(k: string, type?: string) {
      const v = store.get(k);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k: string, v: string, opts?: unknown) { store.set(k, v); puts.push({ key: k, opts }); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cacheStatus: null }; },
    async getWithMetadata() { return { value: null, metadata: null, cacheStatus: null }; },
  };
}

let tenant = 5000;
const nextTenant = () => ++tenant;

/** Embeds by keyword so "paraphrase" and "different question" are controllable. */
const vectors: Record<string, number[]> = {
  'Is this a refund request?': [1, 0, 0],
  'Is this one a refund request?': [0.99, 0.05, 0],
  'Customer wants money back?': [0.88, 0.47, 0],
  'What colour is the sky?': [0, 0, 1],
};

function harness(over: Partial<SemanticChatDeps> = {}) {
  const semKv = fakeKV();
  const authKv = fakeKV();
  const env = { SEMANTIC_CACHE_KV: semKv, AUTH_CACHE_KV: authKv } as unknown as ProxyEnv;
  const log = vi.fn();
  const deps: SemanticChatDeps = {
    embed: async (_env, text) => vectors[text] ?? null,
    factsRevision: async () => 'rev-1',
    log,
    ...over,
  };
  return { env, semKv, authKv, log, deps };
}

const req = (question: string, over: Record<string, unknown> = {}) => ({
  model: 'openai/gpt-test',
  useCase: 'classification',
  temperature: 0.25,
  messages: [{ role: 'system', content: 'Answer yes or no.' }, { role: 'user', content: question }],
  ...over,
}) as unknown as ChatCompletionRequest;

const answered = (text: string): ProxyResult => ({
  response: new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 20, completion_tokens: 1 } }), { status: 200 }),
  resolvedModel: 'openai/gpt-test',
  resolvedVendor: 'openrouter',
  retries: 0,
  failovers: [],
} as ProxyResult);

async function answer(h: ReturnType<typeof harness>, grant: ResponseCacheGrant, q: string, text: string): Promise<void> {
  const plan = await planSemanticChat(h.env, req(q), grant, h.deps);
  expect(plan).not.toBeNull();
  await storeSemanticChat(h.env, plan!, answered(text));
}

async function ask(h: ReturnType<typeof harness>, grant: ResponseCacheGrant, q: string, over: Record<string, unknown> = {}) {
  const plan = await planSemanticChat(h.env, req(q, over), grant, h.deps);
  if (!plan) return null;
  return lookupSemanticChat(h.env, plan, grant, h.deps);
}

beforeEach(() => __clearL1CacheForTests());

describe('eligibility', () => {
  it('allows temperature up to 0.3 but never tools, streams or a chat use case', async () => {
    const h = harness();
    const g = { tenantId: nextTenant() };
    expect(await planSemanticChat(h.env, req('Is this a refund request?'), g, h.deps)).not.toBeNull();
    expect(await planSemanticChat(h.env, req('Is this a refund request?', { temperature: 0.31 }), g, h.deps)).toBeNull();
    expect(await planSemanticChat(h.env, req('Is this a refund request?', { tools: [{ type: 'function' }] }), g, h.deps)).toBeNull();
    expect(await planSemanticChat(h.env, req('Is this a refund request?', { stream: true }), g, h.deps)).toBeNull();
    expect(await planSemanticChat(h.env, req('Is this a refund request?', { useCase: 'chat' }), g, h.deps)).toBeNull();
  });

  it('no embedding → no plan (the request just dispatches)', async () => {
    const h = harness({ embed: async () => null });
    expect(await planSemanticChat(h.env, req('Is this a refund request?'), { tenantId: nextTenant() }, h.deps)).toBeNull();
  });

  it('matches meaning on the last user message and everything else exactly', () => {
    const split = splitSemanticQuery([{ role: 'system', content: 'rubric' }, { role: 'user', content: 'input' }]);
    expect(split).toEqual({ query: 'input', context: [{ role: 'system', content: 'rubric' }] });
  });

  it('model class is a tier, not an exact id; absent model is auto', () => {
    expect(modelClassOf(undefined)).toBe('auto');
    expect(typeof modelClassOf('openai/gpt-test')).toBe('string');
  });
});

describe('lookup', () => {
  it('serves a paraphrase at/above 0.92 as a cache hit', async () => {
    const h = harness();
    const g = { tenantId: nextTenant(), projectId: 3, principal: { userId: 'alice', role: 'member' } };
    await answer(h, g, 'Is this a refund request?', 'yes');
    const hit = await ask(h, g, 'Is this one a refund request?');
    expect(hit?.outcome).toBe('response_cache_hit');
    const body = (await hit!.response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0]?.message.content).toBe('yes');
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'semantic_cache.hit' }));
  });

  it('logs a near miss in [0.85, 0.92) and does not serve it', async () => {
    const h = harness();
    const g = { tenantId: nextTenant() };
    await answer(h, g, 'Is this a refund request?', 'yes');
    expect(await ask(h, g, 'Customer wants money back?')).toBeNull();
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'semantic_cache.near_miss' }));
  });

  it('never crosses a principal, a role, a project or different instructions', async () => {
    const h = harness();
    const t = nextTenant();
    const alice = { tenantId: t, projectId: 3, principal: { userId: 'alice', role: 'member' } };
    await answer(h, alice, 'Is this a refund request?', 'yes');
    expect(await ask(h, { ...alice, principal: { userId: 'bob', role: 'member' } }, 'Is this a refund request?')).toBeNull();
    expect(await ask(h, { ...alice, principal: { userId: 'alice', role: 'owner' } }, 'Is this a refund request?')).toBeNull();
    expect(await ask(h, { ...alice, projectId: 4 }, 'Is this a refund request?')).toBeNull();
    expect(await ask(h, alice, 'Is this a refund request?', {
      messages: [{ role: 'system', content: 'Answer in French.' }, { role: 'user', content: 'Is this a refund request?' }],
    })).toBeNull();
    expect(await ask(h, alice, 'Is this a refund request?')).not.toBeNull();
  });

  it('a changed project-facts revision is a miss', async () => {
    let rev = 'rev-1';
    const h = harness({ factsRevision: async () => rev });
    const g = { tenantId: nextTenant(), projectId: 3 };
    await answer(h, g, 'Is this a refund request?', 'yes');
    rev = 'rev-2';
    expect(await ask(h, g, 'Is this a refund request?')).toBeNull();
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'semantic_cache.stale' }));
  });

  it('a changed anchored file is a miss; an unchanged one still hits', async () => {
    const h = harness();
    const t = nextTenant();
    const at = (hash: string): ResponseCacheGrant => ({ tenantId: t, projectId: 3, fileAnchors: [{ path: 'src/a.ts', contentHash: hash }] });
    await answer(h, at('h1'), 'Is this a refund request?', 'yes');
    expect(await ask(h, at('h1'), 'Is this a refund request?')).not.toBeNull();
    expect(await ask(h, at('h2'), 'Is this a refund request?')).toBeNull();
  });
});

describe('groundsHold', () => {
  it('a file nobody can read is not evidence of change', async () => {
    expect(await groundsHold({ a: [{ p: 'x', h: '1' }] }, {}, async () => null)).toBe(true);
    expect(await groundsHold({ a: [{ p: 'x', h: '1' }] }, {}, async () => '2')).toBe(false);
  });
});

describe('TTL (defect 11)', () => {
  it('every KV write carries the 7-day expirationTtl', async () => {
    const h = harness();
    await answer(h, { tenantId: nextTenant() }, 'Is this a refund request?', 'yes');
    expect(h.semKv.puts.length).toBeGreaterThan(0);
    for (const put of h.semKv.puts) expect(put.opts).toEqual({ expirationTtl: SEMANTIC_CACHE_TTL_SECONDS });
    expect(SEMANTIC_CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});
