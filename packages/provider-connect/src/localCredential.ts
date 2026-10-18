/**
 * The LOCAL CREDENTIAL — a connected subscription's short-lived access token, handed to a
 * runtime on the person's own machine so it can call the provider directly.
 *
 *   POST /llm/provider-keys/:provider/local-credential
 *     200 { provider, runtime, accessToken, expiresAt (epoch ms), baseUrl, models[] }
 *     404 { code: 'provider_not_connected' }       → connect first
 *     409 { code: 'provider_reconnect_required' }  → the stored grant is dead; connect again
 *
 * Why the machine and not the gateway: some providers refuse our cloud egress outright
 * (Kimi's edge answers the Workers ASN with an HTML 403 before it reads a credential),
 * and the personal interactive client such a subscription is licensed for is exactly the
 * editor or browser the person is sitting at.
 *
 * Why the gateway still OWNS the grant: Kimi rotates its refresh token on every grant.
 * Two refreshers of one grant — the server and a laptop, or two laptops — means one of
 * them is always holding a retired token. So the server stays the single refresher and a
 * client only ever receives the access token, never the refresh token. That is also what
 * makes persisting it locally safe: the worst a leaked cache entry buys is fifteen minutes.
 *
 * Persisted through an injected string store (the editor's SecretStorage, Rovr's
 * `chrome.storage.local`), so a restart reuses an unexpired token instead of a round trip.
 */
import { errorDetail, field, stringField, type GatewayRequest } from './port.js';

export interface LocalCredentialModel {
  /** The id the provider's API expects on the wire, e.g. `k3`. */
  model: string;
  /** The provider's own label, e.g. "Kimi K3". */
  displayName: string;
  contextWindow?: number;
}

export interface LocalCredential {
  provider: string;
  /** The local runtime id that dispatches it (`kimi-code`). */
  runtime: string;
  accessToken: string;
  /** Absolute expiry, epoch MILLISECONDS. */
  expiresAt: number;
  /** OpenAI-compatible base, e.g. `https://api.kimi.com/coding/v1`. */
  baseUrl: string;
  /** In the tenant's chosen order — position 0 leads. */
  models: readonly LocalCredentialModel[];
}

export type LocalCredentialOutcome =
  | { kind: 'credential'; credential: LocalCredential }
  /** Nothing is connected for this provider — the caller offers to connect. */
  | { kind: 'not_connected' }
  /** A connection exists but its grant is dead (revoked, refresh failed) — connect again. */
  | { kind: 'reconnect'; detail: string }
  /** No answer, or one this client cannot use — say so and do not prompt. */
  | { kind: 'unavailable'; detail: string };

/** One fetch, decided. Never throws. */
export async function fetchLocalCredential(request: GatewayRequest, provider: string): Promise<LocalCredentialOutcome> {
  let res: { status: number; body: unknown };
  try {
    res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/local-credential`, { method: 'POST' });
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
  if (res.status === 404 && stringField(res.body, 'code') === 'provider_not_connected') return { kind: 'not_connected' };
  if (res.status === 409) return { kind: 'reconnect', detail: errorDetail(res.body, res.status) };
  if (res.status !== 200) return { kind: 'unavailable', detail: errorDetail(res.body, res.status) };
  const credential = parseLocalCredential(res.body);
  return credential ? { kind: 'credential', credential } : { kind: 'unavailable', detail: 'malformed local credential' };
}

/** Read a credential off the wire OR out of the store — the ONE parser for both. */
export function parseLocalCredential(body: unknown): LocalCredential | null {
  const accessToken = stringField(body, 'accessToken');
  const baseUrl = stringField(body, 'baseUrl');
  const expiresAt = Number(field(body, 'expiresAt'));
  if (!accessToken || !baseUrl || !Number.isFinite(expiresAt)) return null;
  const rawModels = field(body, 'models');
  const models = (Array.isArray(rawModels) ? rawModels : []).flatMap((entry): LocalCredentialModel[] => {
    const model = stringField(entry, 'model');
    if (!model) return [];
    const contextWindow = Number(field(entry, 'contextWindow'));
    return [{
      model,
      displayName: stringField(entry, 'displayName') || model,
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
    }];
  });
  return {
    provider: stringField(body, 'provider'),
    runtime: stringField(body, 'runtime'),
    accessToken,
    expiresAt,
    baseUrl,
    models,
  };
}

/** The string persistence a host provides. */
export interface CredentialStringStore {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Re-fetch once less than this much life remains. Two minutes covers a slow first byte
 * plus a long streamed turn on a fifteen-minute token without refreshing on every call.
 */
export const LOCAL_CREDENTIAL_REFRESH_MARGIN_MS = 2 * 60 * 1000;

export interface LocalCredentialStore {
  /**
   * A credential safe to send right now: the persisted one while it has life left,
   * else a fresh fetch (persisted on success). Concurrent callers share one fetch.
   */
  resolve(): Promise<LocalCredentialOutcome>;
  /**
   * The last known credential's ENDPOINT AND MODELS, synchronously, without any I/O —
   * what a synchronous model list reads. Never trust its token: it may have expired.
   */
  snapshot(): LocalCredential | null;
  /** Load the persisted credential into {@link snapshot}. Call once at start-up. */
  hydrate(): Promise<void>;
  /** Forget it locally (sign-out, disconnect, a 401 from the provider). */
  clear(): Promise<void>;
  /** Called after every change to the snapshot — a host re-reads its model list. */
  subscribe(listener: () => void): () => void;
}

export function createLocalCredentialStore(deps: {
  request: GatewayRequest;
  provider: string;
  store: CredentialStringStore;
  now: () => number;
}): LocalCredentialStore {
  const key = `builderforce.localCredential.${deps.provider}`;
  let current: LocalCredential | null = null;
  let inFlight: Promise<LocalCredentialOutcome> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const usable = (credential: LocalCredential | null): credential is LocalCredential =>
    credential !== null && credential.expiresAt - deps.now() > LOCAL_CREDENTIAL_REFRESH_MARGIN_MS;

  const persist = async (credential: LocalCredential | null) => {
    current = credential;
    try {
      if (credential) await deps.store.set(key, JSON.stringify(credential));
      else await deps.store.delete(key);
    } catch {
      // The token in hand is still valid; a failed write only costs a round trip later.
    }
    notify();
  };

  const fetchFresh = async (): Promise<LocalCredentialOutcome> => {
    const outcome = await fetchLocalCredential(deps.request, deps.provider);
    if (outcome.kind === 'credential') await persist(outcome.credential);
    // A definite "not connected" / "reconnect" retires what we held; "unavailable" (offline,
    // a gateway blip) does not — the persisted token may well still work.
    else if (outcome.kind !== 'unavailable') await persist(null);
    return outcome;
  };

  return {
    async resolve() {
      if (usable(current)) return { kind: 'credential', credential: current };
      if (!inFlight) inFlight = fetchFresh().finally(() => { inFlight = null; });
      return inFlight;
    },
    snapshot: () => current,
    async hydrate() {
      let raw: string | undefined | null;
      try {
        raw = await deps.store.get(key);
      } catch {
        raw = null;
      }
      if (!raw) return;
      try {
        current = parseLocalCredential(JSON.parse(raw));
      } catch {
        current = null;
      }
      notify();
    },
    clear: () => persist(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
