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
 * Connect card (a user gesture, which Chrome needs to grant Kimi's API origin).
 */
import type { HostLocalPin } from '@seanhogg/builderforce-brain-embedded';
import { KIMI_CODE_API_HOST } from '@builderforce/kimi-oauth';
import { clientPinOf, type LocalFirstAccount } from '@builderforce/local-inference';
import type { GatewayRequest, LocalCredentialStore } from '@builderforce/provider-connect';
import { createConnectedAccounts } from '@builderforce/provider-connect/accounts';
import type { KeyValueStore } from '../platform/keyValue';

export const KIMI_PROVIDER = 'kimi';
/** The local runtime id a Kimi model ref names (`local/kimi-code/<model>`). */
export const KIMI_RUNTIME = 'kimi-code';
/** The origin Rovr must be granted to call Kimi — requested from the Connect click. */
export const KIMI_API_ORIGINS = [`https://${KIMI_CODE_API_HOST}/*`];

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
  store: LocalCredentialStore;
  /** Where a Kimi pin (`local/kimi-code/<model>` or the gateway's `direct/kimi-code/<model>`)
   *  runs, or null for any other ref. */
  pinFor(ref: string): Promise<HostLocalPin | null>;
  /** The accounts Hybrid tries before the gateway — none until Kimi's origin is granted. */
  hybridAccounts(): Promise<LocalFirstAccount[]>;
}

/**
 * Rovr's binding of the shared connected accounts (`@builderforce/provider-connect/accounts`,
 * the same implementation the editor runs). What is Rovr's own: the browser storage, the
 * origin permission Chrome needs before Kimi can be called, and the Connect card a
 * {@link ProviderConnectRequired} raises.
 */
export function createConnectedAccount(deps: {
  /** The panel's ONE status-preserving gateway call (`PanelServices.gateway`). */
  request: GatewayRequest;
  storage: KeyValueStore;
  /** Whether Rovr may call Kimi's origin (`chrome.permissions.contains`). */
  originGranted(): Promise<boolean>;
  now: () => number;
}): ConnectedAccount {
  const accounts = createConnectedAccounts({
    request: deps.request,
    store: {
      get: (key) => deps.storage.get<string>(key),
      set: (key, value) => deps.storage.set(key, value),
      delete: (key) => deps.storage.remove(key),
    },
    now: deps.now,
  });

  return {
    store: accounts.store(KIMI_PROVIDER),
    async pinFor(ref) {
      const pin = clientPinOf(ref);
      const provider = pin ? accounts.providerFor(pin.provider) : null;
      if (!provider) return null;
      if (!(await deps.originGranted())) throw new ProviderConnectRequired(provider, 'origin');
      const outcome = await accounts.pinFor(ref);
      if (!outcome) return null;
      if (outcome.kind === 'endpoint') return { endpoint: outcome.endpoint, model: outcome.model };
      if (outcome.kind === 'unavailable') throw new Error(outcome.detail);
      throw new ProviderConnectRequired(provider, outcome.reason);
    },
    async hybridAccounts() {
      return (await deps.originGranted()) ? accounts.hybridAccounts() : [];
    },
  };
}
