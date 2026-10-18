/**
 * The workspace's connected Kimi account, used FROM THIS BROWSER.
 *
 * Kimi's edge refuses our cloud's egress, so a Kimi turn has to be made by a client on the
 * person's own machine — which Rovr is. The gateway keeps the connection (and is its only
 * refresher); Rovr fetches the short-lived access token, persists it in
 * `chrome.storage.local` and sends the call straight to Kimi. See
 * `@builderforce/provider-connect` for the contract the editor shares.
 *
 * A pinned Kimi model that cannot be served raises {@link ProviderConnectRequired} rather
 * than routing elsewhere: the person picked Kimi, and the panel answers that error with a
 * Connect card (a user gesture, which Chrome needs to grant the `api.kimi.com` origin).
 */
import type { HostLocalPin } from '@seanhogg/builderforce-brain-embedded';
import { parseLocalModelRef } from '@builderforce/local-inference';
import { createLocalCredentialStore, type GatewayRequest, type LocalCredentialStore } from '@builderforce/provider-connect';
import type { ApiClient } from '../api/apiClient';
import type { KeyValueStore } from '../platform/keyValue';

export const KIMI_PROVIDER = 'kimi';
/** The local runtime id a Kimi model ref names (`local/kimi-code/<model>`). */
export const KIMI_RUNTIME = 'kimi-code';
/** The origin Rovr must be granted to call Kimi — requested from the Connect click. */
export const KIMI_API_ORIGINS = ['https://api.kimi.com/*'];

const CONNECT_REQUIRED_PREFIX = 'provider_connect_required:';

/** A Kimi turn needs the account connected (or renewed, or the origin granted) first. */
export class ProviderConnectRequired extends Error {
  constructor(readonly provider: string, detail?: string) {
    super(`${CONNECT_REQUIRED_PREFIX}${provider}${detail ? ` ${detail}` : ''}`);
    this.name = 'ProviderConnectRequired';
  }
}

/** The provider a run error asks to connect, or null — read off the run's error TEXT,
 *  because that is all a failed run keeps. */
export function connectRequiredProvider(error: string | null | undefined): string | null {
  const at = error?.indexOf(CONNECT_REQUIRED_PREFIX) ?? -1;
  if (!error || at < 0) return null;
  return error.slice(at + CONNECT_REQUIRED_PREFIX.length).split(/\s/)[0] || null;
}

export interface ConnectedAccount {
  /** The gateway call the connect flow runs over (status-preserving). */
  request: GatewayRequest;
  store: LocalCredentialStore;
  /** Where a `local/kimi-code/<model>` pin runs, or null for any other ref. */
  pinFor(ref: string): Promise<HostLocalPin | null>;
}

export function createConnectedAccount(deps: {
  api: ApiClient;
  storage: KeyValueStore;
  /** Whether Rovr may call Kimi's origin (`chrome.permissions.contains`). */
  originGranted(): Promise<boolean>;
  now: () => number;
}): ConnectedAccount {
  const request: GatewayRequest = (path, init) => deps.api.raw(path, {
    method: init?.method ?? 'GET',
    ...(init?.json !== undefined ? { json: init.json } : {}),
  });
  const store = createLocalCredentialStore({
    request,
    provider: KIMI_PROVIDER,
    store: {
      get: (key) => deps.storage.get<string>(key),
      set: (key, value) => deps.storage.set(key, value),
      delete: (key) => deps.storage.remove(key),
    },
    now: deps.now,
  });

  return {
    request,
    store,
    async pinFor(ref) {
      const pin = parseLocalModelRef(ref);
      if (!pin || pin.provider !== KIMI_RUNTIME) return null;
      if (!(await deps.originGranted())) throw new ProviderConnectRequired(KIMI_PROVIDER, 'origin');
      const outcome = await store.resolve();
      if (outcome.kind === 'credential') {
        return { endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken }, model: pin.model };
      }
      if (outcome.kind === 'unavailable') throw new Error(outcome.detail);
      throw new ProviderConnectRequired(KIMI_PROVIDER, outcome.kind);
    },
  };
}
