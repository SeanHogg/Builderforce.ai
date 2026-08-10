/**
 * BYO PRECEDENCE → ROUTING. The tenant orders ONE list that interleaves connected
 * providers with named OpenRouter connections (see `byoPrecedence.ts`); these tests pin
 * that the ROUTING side reads BOTH halves of it.
 *
 * The bug they lock out: `explicitModelPreemptsByo` consulted only `byoVendors`, which an
 * OpenRouter CONNECTION never contributes to (it has no provider row and no vendor id). So
 * a tenant whose #1 was a connection had it silently skipped in two different ways —
 * a deliberately-pinned connection ref was discarded as "not BYO", and (with no provider
 * connected at all) every stale caller default was treated as preempting.
 */

import { describe, it, expect } from 'vitest';
import { explicitModelPreemptsByo, pickCloudModel } from './LlmProxyService';
import { byoAwareModel } from './tenantProxy';

/** The refs a connection contributes — `openrouter/<org>/<slug>` (connectionModelRef). */
const REGISTERED = ['openrouter/moonshotai/kimi-k2', 'openrouter/qwen/qwen3-coder'];

describe('explicitModelPreemptsByo — registered OpenRouter connections', () => {
  it('honours a pin that IS one of the tenant\'s registered connection refs', () => {
    // A deliberate pick on the operator's own list. Without registered-awareness the
    // `openrouter` vendor is in nobody's `byoVendors`, so this returned false and the pin
    // was thrown away.
    expect(explicitModelPreemptsByo(REGISTERED[0], new Set(['anthropic']), REGISTERED)).toBe(true);
    expect(explicitModelPreemptsByo(REGISTERED[0], new Set(), REGISTERED)).toBe(true);
  });

  it('does NOT let a non-BYO pin preempt when a connection is the ONLY rankable account', () => {
    // No provider connected → `byoVendors` empty. The old rule read that as "nothing
    // connected, normal plan routing" and honoured a stale `@cf/*` default over the
    // connection the tenant ranked first.
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', new Set(), REGISTERED)).toBe(false);
  });

  it('keeps the unchanged behaviour when nothing at all is connected', () => {
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', new Set(), [])).toBe(true);
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', undefined, undefined)).toBe(true);
  });

  it('still lets a pin on a connected PROVIDER account preempt, and a foreign one not', () => {
    expect(explicitModelPreemptsByo('claude-opus-5', new Set(['anthropic']), REGISTERED)).toBe(true);
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', new Set(['anthropic']), REGISTERED)).toBe(false);
  });

  it('accepts a Set of refs as well as an array (both shapes callers already hold)', () => {
    expect(explicitModelPreemptsByo(REGISTERED[1], new Set(['anthropic']), new Set(REGISTERED))).toBe(true);
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', new Set(), new Set(REGISTERED))).toBe(false);
  });

  it('treats a blank pin as no pin regardless of what is registered', () => {
    expect(explicitModelPreemptsByo('   ', new Set(), REGISTERED)).toBe(false);
    expect(explicitModelPreemptsByo(null, new Set(), REGISTERED)).toBe(false);
  });
});

describe('byoAwareModel — the tenantProxy gate every one-shot AI feature shares', () => {
  it('keeps a registered connection ref instead of silently dropping it', () => {
    expect(byoAwareModel(REGISTERED[0], new Set(['anthropic']), REGISTERED)).toBe(REGISTERED[0]);
  });

  it('drops a stale non-BYO base model so the connection-led seed runs', () => {
    expect(byoAwareModel('@cf/qwen/qwen3-30b-a3b-fp8', new Set(), REGISTERED)).toBeUndefined();
  });
});

describe('pickCloudModel — the cloud-run pin agrees with the gateway seed', () => {
  it('strict-pins a registered connection ref even for a free tenant', () => {
    // A connection ref is BYO-ish (it is on the tenant's own registered list), so the
    // free-plan model-choice gate must not swallow it.
    const pick = pickCloudModel(REGISTERED[0], 'free', false, {
      byoVendors: new Set(),
      registeredOpenRouterModels: REGISTERED,
    });
    expect(pick).toMatchObject({ model: REGISTERED[0], strict: true });
  });

  it('leads with the precedence-leading connection over a non-BYO explicit model', () => {
    const pick = pickCloudModel('@cf/qwen/qwen3-30b-a3b-fp8', 'pro', false, {
      byoVendors: new Set(),
      registeredOpenRouterModels: REGISTERED,
      preferredRegisteredModel: REGISTERED[0],
    });
    expect(pick).toMatchObject({ model: REGISTERED[0], strict: false });
  });

  it('leads with the connection even when a provider is ALSO connected but ranked lower', () => {
    // `preferredRegisteredModel` is only set by resolveTenantLlmCredentials when the
    // leading connection outranks every usable provider — exactly this case.
    const pick = pickCloudModel(undefined, 'pro', false, {
      byoVendors: new Set(['anthropic']),
      byoVendorPriority: ['anthropic'],
      registeredOpenRouterModels: REGISTERED,
      preferredRegisteredModel: REGISTERED[0],
    });
    expect(pick.model).toBe(REGISTERED[0]);
  });
});
