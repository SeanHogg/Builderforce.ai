import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAllVendorIds,
  getModule,
  vendorForModel,
  parseVendorPrefix,
  vendorAutoRoutes,
  autoRoutableModelsByTier,
  dispatchVendor,
} from './registry';
import type { VendorEnv } from './types';
import {
  openAICompatibleModules,
  OPENAI_COMPATIBLE_VENDOR_KEYS,
  passthroughVendorKeys,
} from './openaiCompatibleVendors';

// ---------------------------------------------------------------------------
// "30+ model providers" must be LITERALLY TRUE at the gateway: the vendor
// registry has to carry ≥30 real, wired vendor modules — and each new
// OpenAI-compatible vendor must build a correct request (Bearer auth + its own
// base URL) and route through the SAME dispatch machinery as the original seven.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('vendor registry — "30+ providers" claim', () => {
  it('registers at least 30 wired vendors', () => {
    const ids = getAllVendorIds();
    expect(ids.length).toBeGreaterThanOrEqual(30);
    // No duplicates — every id is distinct.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every factory vendor is a real module (key reader + catalog + call, no throwing placeholder)', () => {
    for (const mod of openAICompatibleModules) {
      expect(typeof mod.apiKeyFrom).toBe('function');
      expect(typeof mod.call).toBe('function');
      expect(typeof mod.tierFor).toBe('function');
      // Each has a non-empty curated default catalog of real model ids.
      expect(mod.catalog.length).toBeGreaterThan(0);
      // Explicit-pin-only: never silently auto-selected into FREE/PRO pools.
      expect(mod.autoRoute).toBe(false);
    }
  });

  it('a bound key makes the vendor key-bound; an unbound one does not', () => {
    const groq = getModule('groq');
    expect(groq.apiKeyFrom({ GROQ_API_KEY: 'gsk_test' } as VendorEnv)).toBe('gsk_test');
    expect(groq.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('explicit direct/<vendor>/<id> prefix routing reaches the new vendors', () => {
  it('routes a groq pin to the groq vendor', () => {
    expect(parseVendorPrefix('direct/groq/llama-3.3-70b-versatile')).toEqual({
      vendor: 'groq',
      modelId: 'llama-3.3-70b-versatile',
    });
    expect(vendorForModel('direct/groq/llama-3.3-70b-versatile')).toBe('groq');
  });

  it('routes a deepseek and an openai pin to their vendors', () => {
    expect(vendorForModel('direct/deepseek/deepseek-chat')).toBe('deepseek');
    expect(vendorForModel('direct/openai/gpt-4o')).toBe('openai');
  });

  it('does NOT hijack OpenRouter <org>/<slug> ids (no bare-prefix collision)', () => {
    // These are OpenRouter model ids that share an org name with a direct vendor —
    // they must still resolve to OpenRouter, never the direct vendor.
    expect(vendorForModel('openai/gpt-oss-120b:free')).toBe('openrouter');
    expect(vendorForModel('mistralai/mistral-7b')).toBe('openrouter');
    expect(vendorForModel('deepseek/deepseek-v4-flash')).toBe('openrouter');
  });

  it('the new vendors stay OUT of the auto-selected FREE/PRO pools', () => {
    expect(vendorAutoRoutes('groq')).toBe(false);
    expect(vendorAutoRoutes('deepseek')).toBe(false);
    // No factory-vendor model id leaks into the auto-routable pools.
    const autoIds = new Set(autoRoutableModelsByTier('FREE', 'STANDARD', 'PREMIUM', 'ULTRA'));
    for (const mod of openAICompatibleModules) {
      for (const entry of mod.catalog) {
        expect(autoIds.has(entry.id)).toBe(false);
      }
    }
  });
});

describe('a factory vendor builds a correct OpenAI-compatible request', () => {
  it('POSTs to the vendor base URL with a Bearer auth header and the pinned model in the body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const env: VendorEnv = { GROQ_API_KEY: 'gsk_secret' };
    const result = await dispatchVendor({
      env,
      modelChain: ['direct/groq/llama-3.3-70b-versatile'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('groq');
    expect(result.modelUsed).toBe('direct/groq/llama-3.3-70b-versatile');
    expect(result.content).toBe('ok');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // Correct base URL.
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    // Correct Bearer auth header.
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gsk_secret');
    expect(headers['Content-Type']).toBe('application/json');
    // The un-prefixed model id is sent to the upstream (prefix stripped).
    const sentBody = JSON.parse(call.init.body as string) as { model: string; messages: unknown[] };
    expect(sentBody.model).toBe('llama-3.3-70b-versatile');
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('an unbound vendor key is skipped (cascade falls through to the next candidate)', async () => {
    const seen: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL) => {
      seen.push(typeof input === 'string' ? input : input.toString());
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'served' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    // deepseek key unbound, groq key bound → the chain skips deepseek, serves on groq.
    const result = await dispatchVendor({
      env: { GROQ_API_KEY: 'gsk_secret' } as VendorEnv,
      modelChain: ['direct/deepseek/deepseek-chat', 'direct/groq/llama-3.3-70b-versatile'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('groq');
    // deepseek never hit the network (no key) — only groq did.
    expect(seen).toEqual(['https://api.groq.com/openai/v1/chat/completions']);
  });
});

describe('passthroughVendorKeys', () => {
  it('exposes one key per factory vendor and copies bound keys (null when absent)', () => {
    expect(OPENAI_COMPATIBLE_VENDOR_KEYS.length).toBe(openAICompatibleModules.length);
    const out = passthroughVendorKeys({ GROQ_API_KEY: 'gsk', DEEPSEEK_API_KEY: 'dsk' } as VendorEnv);
    expect(out.GROQ_API_KEY).toBe('gsk');
    expect(out.DEEPSEEK_API_KEY).toBe('dsk');
    // An unbound vendor key is present as null (so the dispatcher's key check is honest).
    expect(out.OPENAI_API_KEY).toBeNull();
  });
});
