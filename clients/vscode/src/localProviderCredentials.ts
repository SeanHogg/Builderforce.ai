/**
 * The connected-subscription credentials this editor holds LOCALLY — one
 * `@builderforce/provider-connect` store per provider, persisted in SecretStorage.
 *
 * A provider that refuses our cloud (Kimi) is called from this machine instead, with a
 * short-lived access token the gateway issues from the workspace's connection. The gateway
 * stays the single refresher of that grant; this module only keeps the latest access token
 * so a turn — or a restart — does not pay a round trip while it is still good.
 *
 * Kept free of the request layer on purpose: the synchronous model-config reader
 * (`gateway.getLocalModelsConfig`) needs the {@link localCredentialSnapshot}, and the
 * request adapter sits above `bfApi`, which itself imports `gateway`. The adapter is
 * therefore INJECTED once at activation rather than imported here.
 */
import type * as vscode from "vscode";
import {
  createLocalCredentialStore,
  type GatewayRequest,
  type LocalCredential,
  type LocalCredentialStore,
} from "@builderforce/provider-connect";

/** The providers whose subscription this editor may use locally (see the API's
 *  `LOCAL_CREDENTIAL_SOURCES`). */
export const LOCAL_CREDENTIAL_PROVIDERS = ["kimi"] as const;
export type LocalCredentialProvider = (typeof LOCAL_CREDENTIAL_PROVIDERS)[number];

const stores = new Map<LocalCredentialProvider, LocalCredentialStore>();

/**
 * Create and hydrate every store. Called once from `activate`; `onChange` fires whenever a
 * credential arrives or is dropped, so the caller can drop memoized model lists.
 */
export async function initLocalProviderCredentials(
  secrets: vscode.SecretStorage,
  request: GatewayRequest,
  onChange: () => void,
): Promise<void> {
  for (const provider of LOCAL_CREDENTIAL_PROVIDERS) {
    const store = createLocalCredentialStore({
      request,
      provider,
      store: {
        get: (key) => Promise.resolve(secrets.get(key)),
        set: (key, value) => Promise.resolve(secrets.store(key, value)),
        delete: (key) => Promise.resolve(secrets.delete(key)),
      },
      now: Date.now,
    });
    store.subscribe(onChange);
    stores.set(provider, store);
  }
  await Promise.all([...stores.values()].map((store) => store.hydrate()));
}

/** The store for a provider, or undefined before activation created it. */
export function localCredentialStore(provider: LocalCredentialProvider): LocalCredentialStore | undefined {
  return stores.get(provider);
}

/** The last known credential's endpoint and models — synchronous, no I/O. Never send its
 *  token without `resolve()`: it may have expired. */
export function localCredentialSnapshot(provider: LocalCredentialProvider): LocalCredential | null {
  return stores.get(provider)?.snapshot() ?? null;
}

/** Forget every locally held credential — sign-out, so the next account starts clean. */
export async function clearLocalProviderCredentials(): Promise<void> {
  await Promise.all([...stores.values()].map((store) => store.clear()));
}
