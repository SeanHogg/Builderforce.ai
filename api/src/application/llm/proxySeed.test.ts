import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_SERVED_VENDOR_ATTEMPT_CAP, buildCandidateChain, composeCompletionSeed, loadSeedCooldowns } from './proxySeed';
import { resolveProxyConfig } from './proxyConfig';
import { ProxyFunding } from './proxyFunding';
import { tierForModel, vendorForModel, type VendorId } from './vendors';
import { _resetMemoryCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';
import type { LlmProxyOptions, ProxyEnv } from './proxyTypes';
import { capableTwinsOf } from './vendors/modelTwins';

// The real twin catalog, observable: one test below needs a twin the catalog does not
// declare (see 'under the BYO boundary …'); every other test runs the real lookup.
vi.mock('./vendors/modelTwins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vendors/modelTwins')>();
  return { ...actual, capableTwinsOf: vi.fn(actual.capableTwinsOf) };
});
const realCapableTwinsOf = vi.mocked(capableTwinsOf).getMockImplementation()!;

// ---------------------------------------------------------------------------
// The free cap, the twin rule and the free-first order, composed. Free twins are folded
// into the SEED before the free-capped cascade, so a FREE twin is a FREE attempt like
// any other; their cooldowns are prefetched with the seed; and a model the tenant serves
// from their own account is neither capped as "free" nor touched by the twin rule.
// ---------------------------------------------------------------------------

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

function runtime(opts: LlmProxyOptions) {
  const cfg = resolveProxyConfig(env, { disablePaidOverflow: true, ...opts });
  return { cfg, funding: new ProxyFunding(cfg) };
}

const none = () => [new Set<string>(), new Set<VendorId>()] as const;
const freeCount = (chain: readonly string[]) => chain.filter((m) => tierForModel(m) === 'FREE').length;

const NIM_FREE = 'nvidia/nemotron-3-super-120b-a12b';
const OLLAMA_FREE = 'gpt-oss:120b';
const TWIN_FREE = 'deepseek-v4-flash:cloud';
const TWIN_PAID = 'deepseek/deepseek-v4-flash';

beforeEach(() => { _resetMemoryCooldowns(); });
afterEach(() => { vi.mocked(capableTwinsOf).mockImplementation(realCapableTwinsOf); });

/** Six models of the Ollama catalog — enough to show the owner-served cap at work. */
const OLLAMA_SIX = ['gpt-oss:120b', 'kimi-k2.6:cloud', 'glm-5.1:cloud', 'deepseek-v4-flash:cloud', 'gemma4', 'qwen3.5'];
const ollamaCount = (chain: readonly string[]) => chain.filter((m) => vendorForModel(m) === 'ollama').length;

describe('free twins respect the free cap', () => {
  it('a twin already in the seed adds no free attempt past the budget', () => {
    const rt = runtime({ freeBudget: 2 });
    const chain = buildCandidateChain(rt, [NIM_FREE, OLLAMA_FREE, TWIN_FREE, TWIN_PAID], ...none());
    expect(freeCount(chain)).toBeLessThanOrEqual(2);
    expect(chain[chain.length - 1]).toBe(TWIN_PAID);
  });

  it('an inserted twin is capped out when the budget is spent, and the paid model stays', () => {
    const rt = runtime({ freeBudget: 2 });
    const chain = buildCandidateChain(rt, [NIM_FREE, OLLAMA_FREE, TWIN_PAID], ...none());
    expect(freeCount(chain)).toBe(2);
    expect(chain).not.toContain(TWIN_FREE);
    expect(chain).toContain(TWIN_PAID);
  });

  it('with budget to spare the twin runs ahead of its paid original', () => {
    const rt = runtime({ freeBudget: 3 });
    const chain = buildCandidateChain(rt, [NIM_FREE, TWIN_PAID], ...none());
    expect(chain.indexOf(TWIN_FREE)).toBeGreaterThanOrEqual(0);
    expect(chain.indexOf(TWIN_FREE)).toBeLessThan(chain.indexOf(TWIN_PAID));
  });
});

describe('twin cooldowns are prefetched with the seed', () => {
  it('a cooled twin that is not itself in the seed is skipped', async () => {
    const rt = runtime({});
    const seed = [TWIN_PAID]; // the twin is outside the seed prefix entirely
    await recordFailure(env, vendorForModel(TWIN_FREE), TWIN_FREE, 503);
    const [cooledSet, cooledVendors] = await loadSeedCooldowns(rt, seed);
    expect(cooledSet.has(`${vendorForModel(TWIN_FREE)}/${TWIN_FREE}`)).toBe(true);
    expect(buildCandidateChain(rt, seed, cooledSet, cooledVendors)).toEqual([TWIN_PAID]);
  });

  it('a cooled twin of a DEEP seed entry (past the prefetch slice) is read and skipped', async () => {
    const rt = runtime({});
    // Twelve fillers ahead of the paid model: its twin is outside the leading slice.
    const fillers = Array.from({ length: 12 }, (_, i) => `anthropic/claude-filler-${i}`);
    const seed = [...fillers, TWIN_PAID];
    await recordFailure(env, vendorForModel(TWIN_FREE), TWIN_FREE, 503);
    const [cooledSet, cooledVendors] = await loadSeedCooldowns(rt, seed);
    expect(cooledSet.has(`${vendorForModel(TWIN_FREE)}/${TWIN_FREE}`)).toBe(true);
    const chain = buildCandidateChain(rt, seed, cooledSet, cooledVendors);
    expect(chain).not.toContain(TWIN_FREE);
    expect(chain).toContain(TWIN_PAID);
  });

  it('an uncooled twin is inserted', async () => {
    const rt = runtime({});
    const [cooledSet, cooledVendors] = await loadSeedCooldowns(rt, [TWIN_PAID]);
    expect(buildCandidateChain(rt, [TWIN_PAID], cooledSet, cooledVendors)).toEqual([TWIN_FREE, TWIN_PAID]);
  });
});

describe('owner-served models', () => {
  it('free first keeps a connected Ollama account\'s FREE-tagged models in the chain', async () => {
    const ollamaModels = [OLLAMA_FREE, TWIN_FREE];
    const rt = runtime({
      modelPool: [NIM_FREE, 'gpt-oss-120b', 'google/gemma-4-31b-it:free'],
      freeBudget: 2,
      tenantVendorKeys: { ollama: 'ollama-key' },
      byoSelectedModels: { ollama: ollamaModels },
      allowGatewayAuto: true,
      freeFirst: true,
    });
    const { seed, seedHead } = await composeCompletionSeed(rt, { messages: [{ role: 'user', content: 'hi' }] }, undefined);
    const chain = buildCandidateChain(rt, seed, ...none(), undefined, seedHead);
    for (const model of ollamaModels) expect(chain).toContain(model);
    // The operator's free tier still leads and is still capped.
    const operatorFree = chain.filter((m) => !ollamaModels.includes(m) && tierForModel(m) === 'FREE');
    expect(operatorFree).toHaveLength(2);
    expect(chain.indexOf(OLLAMA_FREE)).toBeGreaterThan(Math.max(...operatorFree.map((m) => chain.indexOf(m))));
  });

  it('a model the tenant serves with their own key gains no operator twin', () => {
    const owned = runtime({ allowGatewayAuto: true, openRouterModelKeys: { [TWIN_PAID]: 'tenant-or-key' } });
    expect(buildCandidateChain(owned, [TWIN_PAID], ...none())).toEqual([TWIN_PAID]);
  });

  it('under the BYO boundary the twin rule is off and the tenant\'s #1 still leads', () => {
    // The twin must be one ONLY the `byoStrict ? seed :` branch keeps out: not owner-served
    // (so `cheaperTwinsOf` would offer it), yet a model the strict filter KEEPS — a model
    // of the tenant's managed-key (keyless) OpenRouter connection. A twin on the connected
    // Ollama vendor proves nothing: it is owner-served, so `cheaperTwinsOf` never offers it
    // whether the branch exists or not. No catalog twin has that shape, so the lookup is
    // stubbed for this one model.
    const managedTwin = 'openrouter/google/gemma-4-31b-it:free';
    vi.mocked(capableTwinsOf).mockImplementation((model) => (model === TWIN_PAID ? [managedTwin] : realCapableTwinsOf(model)));
    const rt = runtime({
      byoRequired: true,
      tenantVendorKeys: { ollama: 'ollama-key' },
      openRouterConnections: [{ id: 1, label: 'managed', models: ['google/gemma-4-31b-it:free'], hasKey: false, priority: null }],
    });
    expect(rt.funding.isOwnerServedModel(managedTwin)).toBe(false);
    expect(rt.cfg.openRouterConnectionModels.has(managedTwin)).toBe(true);
    const head = [OLLAMA_FREE];
    const chain = buildCandidateChain(rt, [...head, TWIN_PAID], ...none(), undefined, head);
    expect(chain[0]).toBe(OLLAMA_FREE);
    // Before: the operator twin of a pool model was smuggled in behind the tenant's own
    // account. Without the branch the managed twin WOULD survive the boundary filter.
    expect(chain).not.toContain(managedTwin);
    expect(chain).toEqual([OLLAMA_FREE]);
  });
});

describe('owner-served vendors are capped per vendor', () => {
  it(`a strict tenant with 6 Ollama pool models tries at most ${OWNER_SERVED_VENDOR_ATTEMPT_CAP} Ollama models`, async () => {
    const rt = runtime({ tenantVendorKeys: { ollama: 'ollama-key' }, byoSelectedModels: { ollama: OLLAMA_SIX } });
    expect(rt.funding.byoStrict).toBe(true);
    const { seed, seedHead } = await composeCompletionSeed(rt, { messages: [{ role: 'user', content: 'hi' }] }, undefined);
    expect(ollamaCount(seed)).toBeGreaterThan(OWNER_SERVED_VENDOR_ATTEMPT_CAP);
    const chain = buildCandidateChain(rt, seed, ...none(), undefined, seedHead);
    expect(ollamaCount(chain)).toBe(OWNER_SERVED_VENDOR_ATTEMPT_CAP);
    expect(chain).toHaveLength(OWNER_SERVED_VENDOR_ATTEMPT_CAP);
  });

  it('the strict owner-served walk keeps the vendor\'s FIRST models, in chain order', () => {
    const rt = runtime({ byoRequired: true, tenantVendorKeys: { ollama: 'ollama-key' } });
    const chain = buildCandidateChain(rt, OLLAMA_SIX, ...none(), undefined, [OLLAMA_SIX[0]!]);
    expect(chain).toEqual(OLLAMA_SIX.slice(0, OWNER_SERVED_VENDOR_ATTEMPT_CAP));
  });

  it('the cap applies outside the BYO boundary too, and leaves operator-funded models alone', () => {
    const rt = runtime({ allowGatewayAuto: true, tenantVendorKeys: { ollama: 'ollama-key' }, freeBudget: 2 });
    expect(rt.funding.byoStrict).toBe(false);
    const chain = buildCandidateChain(rt, [...OLLAMA_SIX, NIM_FREE, TWIN_PAID], ...none());
    expect(ollamaCount(chain)).toBe(OWNER_SERVED_VENDOR_ATTEMPT_CAP);
    expect(chain).toContain(NIM_FREE);
    expect(chain).toContain(TWIN_PAID);
  });
});

describe('a pinned head with a free twin', () => {
  it('the pin still leads; its twin takes one free slot behind it', () => {
    const rt = runtime({ freeBudget: 2 });
    const chain = buildCandidateChain(rt, [TWIN_PAID, NIM_FREE, OLLAMA_FREE], ...none(), TWIN_PAID, [TWIN_PAID]);
    // The head is placed verbatim — the twin inserted ahead of it in the seed never displaces it.
    expect(chain[0]).toBe(TWIN_PAID);
    expect(chain).toContain(TWIN_FREE);
    // The twin is a FREE attempt like any other: with a budget of two it costs the
    // last FREE seed model its slot.
    expect(freeCount(chain)).toBe(2);
    expect(chain).not.toContain(OLLAMA_FREE);
    expect(chain.filter((m) => m === TWIN_PAID)).toHaveLength(1);
  });
});
