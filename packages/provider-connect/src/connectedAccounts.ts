/**
 * The workspace's CONNECTED ACCOUNTS as a client on the person's own machine uses them — the
 * ONE implementation every client shares (the editor and Rovr).
 *
 * A provider whose edge refuses our cloud (Kimi) is called from the client itself, with the
 * short-lived access token the gateway issues from the workspace's connection. This owns the
 * whole client side of that:
 *
 *  - one credential store per provider, created on FIRST USE and hydrated before its first
 *    resolve — so no host has an init step to forget (the editor once never ran its, and every
 *    Kimi turn failed "credentials are not initialized" with no sign-in offered);
 *  - resolving a pick (`local/kimi-code/k3`, `direct/kimi-code/k3`) or a runtime to the
 *    endpoint it is called at, through the runtime registry (`accountProvider`).
 *
 * A host adds only its own UX for a `connect` outcome (a notification, a Connect card) and its
 * own gate (Rovr's origin permission). Kept on its own subpath because it reads the runtime
 * registry, which the web settings card — a consumer of the root entry — never needs.
 */
import {
  LOCAL_RUNTIMES,
  clientPinOf,
  formatLocalModelRef,
  localRuntime,
  type ByoOrderQuery,
  type LocalEndpoint,
  type LocalFirstAccount,
  type LocalFirstAccounts,
  type LocalRuntimeId,
} from '@builderforce/local-inference';
import { createLocalCredentialStore, type CredentialStringStore, type LocalCredentialStore } from './localCredential.js';
import type { GatewayRequest } from './port.js';
import { createByoOrderCache, placeAccount, type ByoOrderOutcome } from './byoOrder.js';

/** Where a connected account's runtime is called, or what stands in the way. */
export type AccountEndpointOutcome =
  | { kind: 'endpoint'; provider: string; endpoint: LocalEndpoint & { token: string } }
  /** Nothing usable is connected (or its grant is dead): the host offers the connect. */
  | { kind: 'connect'; provider: string; reason: 'not_connected' | 'reconnect'; detail?: string }
  /** No answer from the gateway — say so; connecting would not help. */
  | { kind: 'unavailable'; provider: string; detail: string };

export interface ConnectedAccounts {
  /** Every provider a client calls with the workspace's account (registry `accountProvider`). */
  readonly providers: readonly string[];
  /** Load each provider's persisted credential, so a model list shows the account's models
   *  before the first turn. Optional — a store also hydrates on first use. */
  hydrate(): Promise<void>;
  /** The provider's credential store — created (and hydrated) on first use. */
  store(provider: string): LocalCredentialStore;
  /**
   * The provider's token as an endpoint's `credential`: asked before every request, so a run
   * routed with a token that has since expired sends the current one. Handed the token the
   * provider just refused, it drops that one and fetches again.
   */
  credentialFor(provider: string): NonNullable<LocalEndpoint['credential']>;
  /** The account provider a runtime is called with, or null for a runtime that needs none. */
  providerFor(runtime: LocalRuntimeId): string | null;
  /** Where a runtime is called with the workspace's account, or null when it uses none. */
  endpointFor(runtime: LocalRuntimeId): Promise<AccountEndpointOutcome | null>;
  /** Where a pick served by a connected account runs (with the model id its API expects), or
   *  null for any other ref. */
  pinFor(ref: string): Promise<(AccountEndpointOutcome & { model: string }) | null>;
  /**
   * The connected accounts this host calls itself, placed in the tenant's BYO order for the
   * call's context (`query`: its role — absent = none, the tenant's precedence, exactly as
   * the gateway orders a role-less call — project, arc stage and whether it carries tools) —
   * the SERVER's order (`GET /llm/byo-order`, see `byoOrder.ts`), cached per context for a
   * minute (an unreadable answer only for seconds). An account LEADS (after this device,
   * before the gateway) only when its provider is the order's first healthy entry and the
   * tenant funds its accounts first (`freeFirst: false`), on that entry's model; otherwise
   * it TRAILS the gateway, tried only when the gateway fails before any output. With the order unreadable it leads on the credential's
   * first model, as before. The result carries the order's `freeFirst` (absent when
   * unreadable or when no account was placed), which decides where a trailing account sits
   * relative to the plan pool. Never prompts: an account that is not connected is simply
   * absent — asked of the gateway once per session, so an unconnected workspace costs no
   * round trip per call.
   */
  hybridAccounts(query?: ByoOrderQuery): Promise<LocalFirstAccounts>;
  /** Forget every held credential — sign-out; the next account starts clean. */
  clear(): Promise<void>;
}

export function createConnectedAccounts(deps: {
  request: GatewayRequest;
  store: CredentialStringStore;
  now: () => number;
  /** A credential arrived or was dropped — a host re-reads its model list. */
  onChange?: () => void;
}): ConnectedAccounts {
  const stores = new Map<string, LocalCredentialStore>();
  const orders = createByoOrderCache({ request: deps.request, now: deps.now });

  const store = (provider: string): LocalCredentialStore => {
    const existing = stores.get(provider);
    if (existing) return existing;
    const created = createLocalCredentialStore({ request: deps.request, provider, store: deps.store, now: deps.now });
    // A credential that arrived or dropped may be a different account (or none): re-ask the order.
    created.subscribe(() => orders.clear());
    if (deps.onChange) created.subscribe(deps.onChange);
    // Hydrate before the first resolve, so a token persisted by an earlier session is reused
    // rather than raced by a network fetch that a late hydrate would then overwrite.
    const hydrated = created.hydrate();
    const ready: LocalCredentialStore = { ...created, resolve: async (options) => { await hydrated; return created.resolve(options); } };
    stores.set(provider, ready);
    return ready;
  };

  const credentialFor = (provider: string): NonNullable<LocalEndpoint['credential']> => async (rejected) => {
    const outcome = await store(provider).resolve(rejected ? { rejected } : undefined);
    return outcome.kind === 'credential' ? outcome.credential.accessToken : null;
  };

  const providerFor = (runtime: LocalRuntimeId): string | null => localRuntime(runtime).accountProvider ?? null;

  const endpointFor = async (runtime: LocalRuntimeId): Promise<AccountEndpointOutcome | null> => {
    const provider = providerFor(runtime);
    if (!provider) return null;
    const outcome = await store(provider).resolve();
    switch (outcome.kind) {
      case 'credential':
        return {
          kind: 'endpoint',
          provider,
          endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken, credential: credentialFor(provider) },
        };
      case 'not_connected':
        return { kind: 'connect', provider, reason: 'not_connected' };
      case 'reconnect':
        return { kind: 'connect', provider, reason: 'reconnect', detail: outcome.detail };
      default:
        return { kind: 'unavailable', provider, detail: outcome.detail };
    }
  };

  /** Providers already asked this session — a store with no credential after that is
   *  not connected, and is not asked again until a credential arrives. */
  const asked = new Set<string>();
  const hybridAccount = async (
    runtime: (typeof LOCAL_RUNTIMES)[number],
    readOrder: () => Promise<ByoOrderOutcome>,
  ): Promise<LocalFirstAccount[]> => {
    const provider = runtime.accountProvider;
    if (!provider) return [];
    const held = store(provider);
    if (!held.snapshot() && asked.has(provider)) return [];
    asked.add(provider);
    const outcome = await held.resolve();
    if (outcome.kind !== 'credential') return [];
    const listed = outcome.credential.models.map((m) => m.model);
    if (listed.length === 0) return [];
    const placed = placeAccount(await readOrder(), { provider, runtime: runtime.id, listed });
    if (!placed) return [];
    return [{
      ref: formatLocalModelRef(runtime.id, placed.model),
      provider: runtime.id,
      model: placed.model,
      endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken, credential: credentialFor(provider) },
      ...(placed.placement ? { placement: placed.placement } : {}),
    }];
  };

  const providers = [...new Set(LOCAL_RUNTIMES.flatMap((r) => (r.accountProvider ? [r.accountProvider] : [])))];

  return {
    providers,
    hydrate: async () => { await Promise.all(providers.map((p) => store(p).hydrate())); },
    store,
    credentialFor,
    providerFor,
    endpointFor,
    async pinFor(ref) {
      const pin = clientPinOf(ref);
      if (!pin) return null;
      const outcome = await endpointFor(pin.provider);
      return outcome ? { ...outcome, model: pin.model } : null;
    },
    hybridAccounts: async (query = {}) => {
      // Read once per call, and only when some account is connected to place.
      let order: Promise<ByoOrderOutcome> | undefined;
      const readOrder = (): Promise<ByoOrderOutcome> => (order ??= orders.read(query));
      const accounts = (await Promise.all(LOCAL_RUNTIMES.map((runtime) => hybridAccount(runtime, readOrder)))).flat();
      const outcome = order && accounts.length > 0 ? await order : null;
      return outcome?.kind === 'order' ? { accounts, freeFirst: outcome.freeFirst } : { accounts };
    },
    clear: async () => {
      asked.clear();
      orders.clear();
      await Promise.all([...stores.values()].map((s) => s.clear()));
    },
  };
}
