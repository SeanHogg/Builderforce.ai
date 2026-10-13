/**
 * Marketplace CAPABILITY client (PRD 33 §4.2, S6): whether this workspace holds
 * a capability (installed / entitled / sites / usage), the credit packs on sale,
 * and the one-off pack checkout.
 *
 * Paths from `REPLAY_PATHS`, shapes from `@builderforce/interaction-contract`.
 * The state read goes through the browser's ONE read-through cache, keyed by
 * workspace so a workspace switch never shows the previous workspace's answer;
 * every write that can change it (`acquireListing`, a site write, a checkout
 * return) calls {@link invalidateCapabilityState}.
 */

import {
  REPLAY_PATHS,
  type CapabilityPackCheckoutDto,
  type CapabilityPackCheckoutInput,
  type CapabilityStateDto,
  type ReplayPackDto,
} from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { fill, listOf } from './replayHttp';
import { getStoredTenant } from './auth';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

/** Every cached capability read starts with this, so one call drops them all. */
export const CAPABILITY_CACHE_PREFIX = 'capability:';
/** A capability changes on a purchase or an install, never per render. */
export const CAPABILITY_STATE_TTL_MS = 60_000;

/** One record answered bare or under its own name. */
export function oneOf<T>(body: unknown, key: string): T | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (key in record) return (record[key] as T | null) ?? null;
  return body as T;
}

export function capabilityStateKey(slug: string): string {
  return `${CAPABILITY_CACHE_PREFIX}${getStoredTenant()?.id ?? 'none'}:${slug}`;
}

/** The cached answer, if fresh — the first frame of `useCapability`. */
export function readCachedCapabilityState(slug: string): CapabilityStateDto | undefined {
  return readClientCached<CapabilityStateDto>(capabilityStateKey(slug), CAPABILITY_STATE_TTL_MS);
}

/** Drop every cached capability answer; the next read asks the server. */
export function invalidateCapabilityState(): void {
  invalidateClientCache(CAPABILITY_CACHE_PREFIX);
}

export const capabilityApi = {
  /** Installed / entitled / site count / usage for one capability listing. */
  state(slug: string): Promise<CapabilityStateDto> {
    return getOrSetClientCached(
      capabilityStateKey(slug),
      async () => {
        const body = await apiRequest<unknown>(fill(REPLAY_PATHS.capabilityState, { slug }));
        const state = oneOf<CapabilityStateDto>(body, 'state');
        if (!state) throw new Error('capability state: empty answer');
        return state;
      },
      { ttlMs: CAPABILITY_STATE_TTL_MS },
    );
  },

  /** The credit ladder on sale (D4), cheapest first. */
  async packs(): Promise<ReplayPackDto[]> {
    const packs = listOf<ReplayPackDto>(await apiRequest<unknown>(REPLAY_PATHS.capabilityPacks, { expectedErrors: [401, 404] }), 'packs');
    return [...packs].sort((a, b) => a.units - b.units);
  },

  /**
   * Begin a one-off pack purchase; resolves to the processor's hosted checkout
   * URL. The grant happens server-side when the processor confirms payment.
   */
  async startPackCheckout(packId: string, returnUrl: string): Promise<string> {
    const input: CapabilityPackCheckoutInput = { returnUrl };
    const body = await apiRequest<unknown>(fill(REPLAY_PATHS.capabilityPackCheckout, { packId }), {
      method: 'POST',
      body: JSON.stringify(input),
      // 503 = payments are not configured; the panel says so rather than raising a fault.
      expectedErrors: [400, 403, 503],
    });
    const answer = oneOf<CapabilityPackCheckoutDto & { url?: string }>(body, 'checkout');
    const url = answer?.checkoutUrl ?? answer?.url;
    if (!url) throw new Error('pack checkout: no checkout URL');
    return url;
  },
};

/**
 * Where the processor sends a buyer back after a pack purchase: the app with the
 * plan panel open on its packs tab. `{CHECKOUT_SESSION_ID}` is the processor's
 * own placeholder and is left literal.
 */
export function packCheckoutReturnUrl(origin: string, appPath = '/apps/insights'): string {
  return `${origin}${appPath}?panel=plan:packs&checkout={CHECKOUT_SESSION_ID}`;
}
