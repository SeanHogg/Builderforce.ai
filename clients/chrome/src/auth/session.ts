/**
 * Rovr's signed-in identity — ONE credential, read from one place by every context (the
 * side panel and the service worker each hold a Session over the same storage).
 *
 * The credential is the `bfk_*` editor key the device sign-in yields. It authenticates
 * the gateway (`/llm/*`) directly; for the tenant APIs (`/api/*`) it is exchanged for a
 * short-lived tenant JWT through `POST /api/auth/tenant-api-key-token` — the exchange the
 * VS Code extension makes (`bfApi.ts`), not a second auth system.
 *
 * "Signed in" means the key was ACCEPTED: an exchange the server rejects (401/400 — the
 * key was revoked or deleted) signs Rovr out, so the panel never presents a dead key as a
 * live session. An exchange that got no answer (offline) changes nothing.
 *
 * SCOPE: `tenant:<id>` while signed in, `null` signed out. Every durable outbox is scoped
 * by it — a write queued in one workspace is never replayed into another, and writes made
 * while signed out wait (unscoped) for the next sign-in.
 */
import type { KeyValueStore } from '../platform/keyValue';
import { revokeKey } from '@builderforce/device-auth';

const KEY = 'session.key';
const TENANT = 'session.tenantId';

export interface SessionDeps {
  storage: KeyValueStore;
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now(): number;
}

export interface Session {
  /** Load the stored credential. Call once per context before reading `scope()`. */
  ready(): Promise<void>;
  key(): Promise<string | null>;
  isSignedIn(): boolean;
  /** `tenant:<id>` while signed in, else null. Synchronous — read by the outboxes. */
  scope(): string | null;
  tenantId(): number | null;
  signIn(input: { accessKey: string; tenantId: number | null }): Promise<void>;
  signOut(): Promise<void>;
  /** A tenant JWT for `/api/*`, or null signed out / unreachable. */
  jwt(force?: boolean): Promise<string | null>;
  subscribe(listener: () => void): () => void;
}

export function createSession(deps: SessionDeps): Session {
  let key: string | null = null;
  let tenant: number | null = null;
  let jwtCache: { token: string; exp: number } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const load = async (): Promise<void> => {
    key = (await deps.storage.get<string>(KEY)) ?? null;
    tenant = (await deps.storage.get<number>(TENANT)) ?? null;
    jwtCache = null;
  };
  const loaded = load();
  // Another context signed in or out — follow it.
  deps.storage.subscribe((keys) => {
    if (keys.includes(KEY) || keys.includes(TENANT)) void load().then(notify);
  });

  const clear = async (): Promise<void> => {
    key = null;
    tenant = null;
    jwtCache = null;
    await deps.storage.remove(KEY);
    await deps.storage.remove(TENANT);
    notify();
  };

  return {
    ready: () => loaded,
    async key() {
      await loaded;
      return key;
    },
    isSignedIn: () => key !== null,
    scope: () => (key !== null && tenant !== null ? `tenant:${tenant}` : null),
    tenantId: () => tenant,
    async signIn(input) {
      key = input.accessKey;
      tenant = input.tenantId;
      jwtCache = null;
      await deps.storage.set(KEY, input.accessKey);
      if (input.tenantId !== null) await deps.storage.set(TENANT, input.tenantId);
      notify();
    },
    async signOut() {
      const old = key;
      await clear();
      if (old) await revokeKey(deps, old);
    },
    async jwt(force = false) {
      await loaded;
      if (!key) return null;
      if (!force && jwtCache && deps.now() < jwtCache.exp - 60_000) return jwtCache.token;
      let res: Response;
      try {
        res = await deps.fetch(`${deps.baseUrl}/api/auth/tenant-api-key-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey: key }),
        });
      } catch {
        return null; // unreachable — no verdict on the key
      }
      // 401 = invalid/revoked; 400 = a key with no user behind it. A verdict on the key.
      if (res.status === 401 || res.status === 400) {
        await clear();
        return null;
      }
      if (!res.ok) return null;
      const body = (await res.json()) as { token?: string; expiresIn?: number; tenantId?: number };
      if (!body.token) return null;
      jwtCache = { token: body.token, exp: deps.now() + (body.expiresIn ?? 3600) * 1000 };
      if (typeof body.tenantId === 'number' && body.tenantId !== tenant) {
        tenant = body.tenantId;
        await deps.storage.set(TENANT, body.tenantId);
        notify();
      }
      return body.token;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
