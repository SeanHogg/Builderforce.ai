/**
 * The exact-match response cache — and, mostly, the rules about when it must NOT
 * answer. A cache that returns a stale chat turn is a user-visible bug that is very
 * hard to trace back to the cache, so the eligibility policy is the part worth pinning.
 */

import { describe, it, expect } from 'vitest';
import {
  isCacheableRequest,
  responseCacheKey,
  readCachedResponse,
  storeCachedResponse,
  CACHEABLE_USE_CASES,
  MAX_CACHEABLE_TEMPERATURE,
  type ResponseCacheEnv,
} from './responseCache';

const eligible = {
  useCase: 'classification',
  temperature: 0,
  hasTools: false,
  streaming: false,
};

function kvEnv(): ResponseCacheEnv & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    AUTH_CACHE_KV: {
      async get(k: string, type?: string) {
        const v = store.get(k);
        if (v == null) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(k: string, v: string) { store.set(k, v); },
      async delete(k: string) { store.delete(k); },
      async list() { return { keys: [], list_complete: true as const, cacheStatus: null }; },
      async getWithMetadata() { return { value: null, metadata: null, cacheStatus: null }; },
    } as unknown as KVNamespace,
  };
}

describe('isCacheableRequest — never by accident', () => {
  it('allows an idempotent, low-temperature, tool-free, non-streaming request', () => {
    expect(isCacheableRequest(eligible)).toBe(true);
  });

  it('refuses a STREAMING request — there is no single body to store', () => {
    expect(isCacheableRequest({ ...eligible, streaming: true })).toBe(false);
  });

  it('refuses a request carrying TOOLS — replaying one would replay an effect', () => {
    expect(isCacheableRequest({ ...eligible, hasTools: true })).toBe(false);
  });

  it('refuses a high temperature — the caller asked for variety', () => {
    expect(isCacheableRequest({ ...eligible, temperature: 0.9 })).toBe(false);
    expect(isCacheableRequest({ ...eligible, temperature: MAX_CACHEABLE_TEMPERATURE })).toBe(true);
    expect(isCacheableRequest({ ...eligible, temperature: MAX_CACHEABLE_TEMPERATURE + 0.01 })).toBe(false);
  });

  it('treats an ABSENT temperature as eligible', () => {
    // These use cases default low at every vendor, and demanding an explicit
    // `temperature: 0` would exclude nearly every caller that qualifies otherwise.
    expect(isCacheableRequest({ ...eligible, temperature: null })).toBe(true);
  });

  it('refuses an unlisted useCase — the allow-list is the whole safety argument', () => {
    // `useCase` is caller-supplied, so an inferred rule would let any caller opt
    // themselves in by naming their request something that happened to match.
    expect(isCacheableRequest({ ...eligible, useCase: 'chat' })).toBe(false);
    expect(isCacheableRequest({ ...eligible, useCase: 'task_execution' })).toBe(false);
    expect(isCacheableRequest({ ...eligible, useCase: null })).toBe(false);
  });

  it('does not list any conversational use case', () => {
    for (const conversational of ['chat', 'task_execution', 'brain_chat', 'agent_turn']) {
      expect(CACHEABLE_USE_CASES.has(conversational)).toBe(false);
    }
  });
});

describe('responseCacheKey', () => {
  const base = {
    tenantId: 1,
    model: 'a/one',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0,
  };

  it('is stable across key ORDER — two identical requests hash the same', async () => {
    const a = await responseCacheKey({ ...base });
    const b = await responseCacheKey({
      temperature: 0,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'a/one',
      tenantId: 1,
    });
    expect(a).toBe(b);
  });

  it('separates TENANTS', async () => {
    // Not about answer correctness — about not leaking one tenant's prompts to another
    // through a shared entry.
    expect(await responseCacheKey({ ...base })).not.toBe(await responseCacheKey({ ...base, tenantId: 2 }));
  });

  it('separates model, messages, and sampling', async () => {
    const k = await responseCacheKey({ ...base });
    expect(await responseCacheKey({ ...base, model: 'a/two' })).not.toBe(k);
    expect(await responseCacheKey({ ...base, messages: [{ role: 'user', content: 'bye' }] })).not.toBe(k);
    expect(await responseCacheKey({ ...base, temperature: 0.1 })).not.toBe(k);
    expect(await responseCacheKey({ ...base, topP: 0.5 })).not.toBe(k);
  });

  it('separates on response_format — a strict schema changes the answer SHAPE', async () => {
    const k = await responseCacheKey({ ...base });
    expect(await responseCacheKey({ ...base, responseFormat: { type: 'json_object' } })).not.toBe(k);
  });

  it('is tenant-prefixed so entries are attributable at a glance', async () => {
    expect(await responseCacheKey({ ...base })).toMatch(/^respcache:1:[0-9a-f]{64}$/);
  });
});

describe('store + read round-trip', () => {
  it('returns what was stored', async () => {
    const env = kvEnv();
    const key = await responseCacheKey({ tenantId: 7, model: 'm', messages: [{ role: 'user', content: 'q' }] });
    await storeCachedResponse(env, key, {
      body: { choices: [{ message: { content: 'answer' } }] },
      resolvedModel: 'm',
      resolvedVendor: 'openrouter',
    });
    const hit = await readCachedResponse(env, key);
    expect(hit?.resolvedModel).toBe('m');
    expect((hit?.body as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content).toBe('answer');
    expect(typeof hit?.at).toBe('number');
  });

  it('misses cleanly on an unknown key', async () => {
    expect(await readCachedResponse(kvEnv(), 'respcache:1:nope')).toBeNull();
  });

  it('degrades to a miss rather than throwing when there is no KV binding', async () => {
    // A cache read must never be able to fail a request.
    expect(await readCachedResponse({}, 'respcache:1:x')).toBeNull();
    await expect(storeCachedResponse({}, 'respcache:1:x', {
      body: {}, resolvedModel: 'm', resolvedVendor: 'v',
    })).resolves.toBeUndefined();
  });
});
