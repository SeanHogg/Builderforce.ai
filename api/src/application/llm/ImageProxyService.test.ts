import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImageProxyService,
  imageModelPoolForPlan,
  imageProductNameForPlan,
  imageProxyForPlan,
  type ImageProxyEnv,
} from './ImageProxyService';
import { _resetMemoryCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';
import { FREE_IMAGE_MODEL_POOL, _resetImageCursor } from './ImageProxyService';
import type { VendorId } from './vendors';

// The image cascade now consults/writes the shared cooldown store [1438]; with
// no AUTH_CACHE_KV in tests it uses the module-global in-memory backend, so reset
// it between tests to keep cases isolated (a prior cascade's failures must not
// leave models cooled for the next test).
beforeEach(() => { _resetMemoryCooldowns(); _resetImageCursor(); });

// ---------------------------------------------------------------------------
// ImageProxyService — exercises the 2-free-then-premium cascade end-to-end.
// Together is mocked via global fetch (free vendor); FluxAPI is the premium
// fallback. The proxy uses composeFreeCappedCascade under the hood — that
// helper has its own unit tests; here we verify the *integration*: vendor
// dispatch, cascade-on-failure, and the cascade-exhausted envelope.
// ---------------------------------------------------------------------------

const TOGETHER_ENDPOINT = 'https://api.together.xyz/v1/images/generations';
const FLUXAPI_ENDPOINT  = 'https://api.fluxapi.ai/api/v1/flux/kontext/generate';

interface MockedRequest {
  url: string;
  init: RequestInit;
  count: number;
}

function installFetchRouter(routes: Record<string, () => Response | Promise<Response>>): MockedRequest[] {
  const calls: MockedRequest[] = [];
  const counts: Record<string, number> = {};
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    counts[url] = (counts[url] ?? 0) + 1;
    calls.push({ url, init: init ?? {}, count: counts[url]! });
    const handler = routes[url];
    if (!handler) {
      throw new Error(`unmocked fetch: ${url}`);
    }
    return handler();
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const env: ImageProxyEnv = {
  TOGETHER_API_KEY: 'tg-test',
  FLUX_API_KEY:     'flux-test',
};

// ---------------------------------------------------------------------------
// Plan → factory wiring (single source of truth for product naming)
// ---------------------------------------------------------------------------

describe('plan → image product/pool wiring', () => {
  it('free plan → builderforceImage product + FREE pool', () => {
    expect(imageProductNameForPlan('free')).toBe('builderforceImage');
    expect(imageModelPoolForPlan('free').length).toBeGreaterThan(0);
  });

  it('pro plan → builderforceImagePro product + extended pool', () => {
    expect(imageProductNameForPlan('pro')).toBe('builderforceImagePro');
    expect(imageModelPoolForPlan('pro').length)
      .toBeGreaterThanOrEqual(imageModelPoolForPlan('free').length);
  });

  it('premium-override forces builderforceImagePro regardless of plan', () => {
    expect(imageProductNameForPlan('free', true)).toBe('builderforceImagePro');
  });

  it('imageProxyForPlan returns a working ImageProxyService instance', () => {
    const proxy = imageProxyForPlan(env, 'free');
    expect(proxy).toBeInstanceOf(ImageProxyService);
  });

  it('pool ids are VENDOR-PREFIXED so the dispatcher resolves by prefix (id-clash safe)', () => {
    // Every pool entry must carry an explicit `<vendor>/<id>` prefix — a bare id
    // would force an ambiguous catalog lookup that breaks the moment two vendors
    // register the same model id.
    for (const m of imageModelPoolForPlan('free')) {
      expect(m).toMatch(/^(together|fluxapi)\//);
    }
    for (const m of imageModelPoolForPlan('pro')) {
      expect(m).toMatch(/^(together|fluxapi)\//);
    }
  });
});

// ---------------------------------------------------------------------------
// Cascade behaviour
// ---------------------------------------------------------------------------

describe('ImageProxyService.generate — cascade', () => {
  it('returns the Together result when the first free vendor succeeds', async () => {
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response(JSON.stringify({
        created: 100,
        data: [{ url: 'https://together/img.png' }],
      }), { status: 200 }),
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({ prompt: 'a duck' });
    expect(result.body.data).toEqual([{ url: 'https://together/img.png' }]);
    expect(result.resolvedVendor).toBe('together');
    expect(result.retries).toBe(0);
    expect(result.failovers).toEqual([]);
  });

  it('falls through to FluxAPI when ALL Together attempts fail', async () => {
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response('{"error":"throttle"}', { status: 429 }),
      [FLUXAPI_ENDPOINT]:  () => new Response(JSON.stringify({
        data: { url: 'https://flux/result.jpg' },
      }), { status: 200 }),
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({ prompt: 'a duck' });
    expect(result.resolvedVendor).toBe('fluxapi');
    expect(result.resolvedModel).toBe('fluxapi/flux-kontext-pro');
    expect(result.body.data).toEqual([{ url: 'https://flux/result.jpg' }]);
    // FREE_IMAGE_ATTEMPT_BUDGET = 2 Together attempts → retries === 2 failovers recorded
    expect(result.retries).toBe(2);
    expect(result.failovers.map((f) => f.vendor)).toEqual(['together', 'together']);
  });

  it('skips models cooled by a recent failure and falls through to premium [1438]', async () => {
    // Pre-cool every free (Together) model in the shared store, as a prior
    // request's 429s would. The next request must NOT re-fire them.
    for (const m of FREE_IMAGE_MODEL_POOL) {
      await recordFailure(env, 'image:together' as unknown as VendorId, m, 429);
    }
    const requests: string[] = [];
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => { requests.push(TOGETHER_ENDPOINT); return new Response(JSON.stringify({ data: [{ url: 't' }] }), { status: 200 }); },
      [FLUXAPI_ENDPOINT]:  () => new Response(JSON.stringify({ data: { url: 'https://flux/r.jpg' } }), { status: 200 }),
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({ prompt: 'a duck' });
    expect(requests).toEqual([]);                  // cooled Together models skipped — no RTT wasted
    expect(result.resolvedVendor).toBe('fluxapi'); // fell through to the premium fallback
  });

  it('skips Together entirely when TOGETHER_API_KEY is unbound', async () => {
    installFetchRouter({
      [FLUXAPI_ENDPOINT]: () => new Response(JSON.stringify({
        data: { url: 'https://flux/result.jpg' },
      }), { status: 200 }),
    });
    const proxy = new ImageProxyService({ FLUX_API_KEY: 'flux-test' });
    const result = await proxy.generate({ prompt: 'a duck' });
    // No Together attempts recorded — key wasn't bound so they were filtered
    // out of the chain by composeFreeCappedCascade.
    expect(result.resolvedVendor).toBe('fluxapi');
    expect(result.retries).toBe(0);
    expect(result.failovers).toEqual([]);
  });

  it('returns empty data + failovers when every vendor fails (cascade exhausted)', async () => {
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response('{"error":"503"}', { status: 503 }),
      [FLUXAPI_ENDPOINT]:  () => new Response('{"error":"503"}', { status: 503 }),
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({ prompt: 'a duck' });
    expect(result.body.data).toEqual([]);
    // 2 Together failures + 1 Flux failure
    expect(result.failovers.length).toBe(3);
    expect(result.failovers.map((f) => f.vendor)).toEqual(['together', 'together', 'fluxapi']);
  });

  it('respects caller-pinned model when supplied (puts it at chain head)', async () => {
    const requests: string[] = [];
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => {
        requests.push(TOGETHER_ENDPOINT);
        return new Response(JSON.stringify({
          created: 1,
          data: [{ url: 'https://together/pinned.png' }],
        }), { status: 200 });
      },
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({ prompt: 'a duck', model: 'Lykon/DreamShaper' });
    expect(result.resolvedModel).toBe('Lykon/DreamShaper');
    expect(requests).toEqual([TOGETHER_ENDPOINT]);
  });

  it('routes vendor-prefixed model ids correctly (fluxapi/flux-kontext-pro)', async () => {
    installFetchRouter({
      [FLUXAPI_ENDPOINT]: () => new Response(JSON.stringify({
        data: { url: 'https://flux/result.jpg' },
      }), { status: 200 }),
    });
    const proxy = new ImageProxyService(env);
    const result = await proxy.generate({
      prompt: 'a duck',
      model: 'fluxapi/flux-kontext-pro',
    });
    expect(result.resolvedVendor).toBe('fluxapi');
    expect(result.resolvedModel).toBe('fluxapi/flux-kontext-pro');
  });
});

// ---------------------------------------------------------------------------
// FREE-cap guarantee — image-side mirror of the chat 2-free-then-premium rule
// ---------------------------------------------------------------------------

describe('ImageProxyService — FREE cap enforcement', () => {
  beforeEach(() => {
    // Sanity check that the proxy's free pool has > 2 entries so the cap
    // actually matters. Today Together ships two free models — if a future
    // change adds more, this test continues to exercise the cap.
    expect(imageModelPoolForPlan('free').length).toBeGreaterThanOrEqual(2);
  });

  it('attempts at most FREE_IMAGE_ATTEMPT_BUDGET (2) Together calls before falling through', async () => {
    let togetherCalls = 0;
    let fluxCalls = 0;
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => {
        togetherCalls++;
        return new Response('{"error":"429"}', { status: 429 });
      },
      [FLUXAPI_ENDPOINT]: () => {
        fluxCalls++;
        return new Response(JSON.stringify({
          data: { url: 'https://flux/result.jpg' },
        }), { status: 200 });
      },
    });
    const proxy = new ImageProxyService(env);
    await proxy.generate({ prompt: 'a duck' });
    expect(togetherCalls).toBe(2);
    expect(fluxCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Funded paid-overflow classification + cap (migration 0130, image side)
// ---------------------------------------------------------------------------

describe('ImageProxyService — paid-overflow classification & cap', () => {
  it('marks paidOverflow=false when a FREE (Together) model serves the request', async () => {
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response(JSON.stringify({
        created: 1, data: [{ url: 'https://together/img.png' }],
      }), { status: 200 }),
    });
    const result = await new ImageProxyService(env).generate({ prompt: 'a duck' });
    expect(result.resolvedVendor).toBe('together');
    expect(result.paidOverflow).toBe(false);
  });

  it('marks paidOverflow=true when the funded premium fallback (FluxAPI) serves it', async () => {
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response('{"error":"throttle"}', { status: 429 }),
      [FLUXAPI_ENDPOINT]:  () => new Response(JSON.stringify({ data: { url: 'https://flux/r.jpg' } }), { status: 200 }),
    });
    const result = await new ImageProxyService(env).generate({ prompt: 'a duck' });
    expect(result.resolvedModel).toBe('fluxapi/flux-kontext-pro');
    expect(result.paidOverflow).toBe(true);
  });

  it('disablePaidOverflow drops the funded fallback — a saturated free pool exhausts instead of billing us', async () => {
    let fluxCalls = 0;
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response('{"error":"429"}', { status: 429 }),
      [FLUXAPI_ENDPOINT]:  () => { fluxCalls++; return new Response(JSON.stringify({ data: { url: 'x' } }), { status: 200 }); },
    });
    const proxy = new ImageProxyService(env, { disablePaidOverflow: true });
    const result = await proxy.generate({ prompt: 'a duck' });
    expect(fluxCalls).toBe(0);               // funded fallback never attempted
    expect(result.body.data).toEqual([]);    // cascade exhausted on free-only
    expect(result.paidOverflow).toBe(false);
  });

  it('imageProxyForPlan threads disablePaidOverflow into the cascade', async () => {
    let fluxCalls = 0;
    installFetchRouter({
      [TOGETHER_ENDPOINT]: () => new Response('{"error":"429"}', { status: 429 }),
      [FLUXAPI_ENDPOINT]:  () => { fluxCalls++; return new Response(JSON.stringify({ data: { url: 'x' } }), { status: 200 }); },
    });
    const proxy = imageProxyForPlan(env, 'free', false, { disablePaidOverflow: true });
    await proxy.generate({ prompt: 'a duck' });
    expect(fluxCalls).toBe(0);
  });
});
