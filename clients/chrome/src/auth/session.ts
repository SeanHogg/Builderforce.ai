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
import { isWrappedCredential, type CredentialVault } from './credentialVault';
import { createEditorSessionCache, createEditorSessionFlights, exchangeEditorKey, resolveEditorWorkspaceToken, revokeKey, type EditorTenantToken } from '@builderforce/device-auth';

/** Where the credential lives in `chrome.storage.local` — read by the platform policy
 *  too, which derives the default inference mode from "signed in". */
export const SESSION_CREDENTIAL_KEY = 'session.key';
const KEY = SESSION_CREDENTIAL_KEY;
const TENANT = 'session.tenantId';
const USER = 'session.userId';

export interface SessionDeps {
  storage: KeyValueStore;
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now(): number;
  vault?: CredentialVault;
}

export interface Session {
  /** Load the stored credential. Call once per context before reading `scope()`. */
  ready(): Promise<void>;
  key(): Promise<string | null>;
  isSignedIn(): boolean;
  /** `tenant:<id>` while signed in, else null. Synchronous — read by the outboxes. */
  scope(): string | null;
  tenantId(): number | null;
  /** The signed-in user's id, learned from the key->JWT exchange (`userId` in its response) and cached. Null until the first exchange. */
  userId(): string | null;
  signIn(input: { accessKey: string; tenantId: number | null }): Promise<void>;
  signOut(): Promise<void>;
  switchWorkspace(tenantId: number): Promise<boolean>;
  /** Only for person-level routes that must remain reachable from a parked workspace. */
  baseJwt(): Promise<string | null>;
  /** A tenant JWT for `/api/*`, or null signed out / unreachable. */
  jwt(force?: boolean): Promise<string | null>;
  subscribe(listener: () => void): () => void;
}

export function createSession(deps: SessionDeps): Session {
  let key: string | null = null;
  let tenant: number | null = null;
  let user: string | null = null;
  const cache = createEditorSessionCache(deps.now);
  const exchanges = createEditorSessionFlights<string | null>();
  let identityEpoch = 0;
  let loadSequence = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const load = async (): Promise<void> => {
    const sequence = ++loadSequence;
    const [storedCredential, storedTenant, storedUser] = await Promise.all([
      deps.storage.get<unknown>(KEY), deps.storage.get<number>(TENANT), deps.storage.get<string>(USER),
    ]);
    const legacyKey = typeof storedCredential === 'string' ? storedCredential : null;
    const migrated = legacyKey && deps.vault ? await deps.vault.wrap(legacyKey).catch(() => null) : null;
    const storedKey = legacyKey ? (!deps.vault || migrated ? legacyKey : null)
      : isWrappedCredential(storedCredential) && deps.vault ? await deps.vault.unwrap(storedCredential).catch(() => null) : null;
    if (sequence !== loadSequence) return;
    if (key !== (storedKey ?? null) || tenant !== (storedKey ? storedTenant ?? null : null)) {
      identityEpoch += 1;
      cache.clear();
      exchanges.clear();
    }
    key = storedKey ?? null;
    tenant = storedKey ? storedTenant ?? null : null;
    user = storedKey ? storedUser ?? null : null;
    if (migrated && await deps.storage.get<unknown>(KEY) === storedCredential && sequence === loadSequence) {
      await deps.storage.set(KEY, migrated);
    }
  };
  const loaded = load();
  // Another context signed in or out — follow it.
  deps.storage.subscribe((keys) => {
    if (keys.includes(KEY) || keys.includes(TENANT) || keys.includes(USER)) void load().then(notify);
  });

  const clear = async (): Promise<void> => {
    identityEpoch += 1;
    loadSequence += 1;
    key = null;
    tenant = null;
    user = null;
    cache.clear();
    exchanges.clear();
    await deps.storage.remove(KEY);
    await deps.storage.remove(TENANT);
    await deps.storage.remove(USER);
    notify();
  };

  async function mint(target: number | null): Promise<EditorTenantToken | null> {
    const exchangeKey = key;
    if (!exchangeKey) return null;
    const epoch = identityEpoch;
    const isCurrent = () => epoch === identityEpoch;
    const refreshBase = async () => {
      const result = await exchangeEditorKey(deps.baseUrl, exchangeKey, deps.fetch, deps.now);
      if (!isCurrent()) return null;
      if (result.ok) return result.jwt;
      if (result.rejected) await clear();
      return null;
    };
    const base = await refreshBase();
    if (!base) return null;
    if (target === null || target === base.tenantId) return base;
    const scoped = await resolveEditorWorkspaceToken({
      baseUrl: deps.baseUrl, tenantId: target, baseToken: base.token,
      fetch: deps.fetch, now: deps.now, isCurrent, refreshBase,
    });
    return scoped?.state === 'minted' ? { ...scoped.jwt, userId: base.userId } : null;
  }

  async function adopt(token: EditorTenantToken): Promise<void> {
    const tenantChanged = tenant !== token.tenantId;
    const userChanged = token.userId !== undefined && token.userId !== user;
    if (tenantChanged) {
      identityEpoch += 1;
      exchanges.clear();
    }
    loadSequence += 1;
    tenant = token.tenantId;
    if (token.userId !== undefined) user = token.userId;
    cache.tokens.active = token;
    await Promise.all([
      ...(tenantChanged ? [deps.storage.set(TENANT, token.tenantId)] : []),
      ...(userChanged ? [deps.storage.set(USER, token.userId)] : []),
    ]);
    if (tenantChanged || userChanged) notify();
  }

  async function mintAndAdopt(target: number | null): Promise<string | null> {
    const epoch = identityEpoch;
    const token = await mint(target);
    if (!token || epoch !== identityEpoch) return null;
    await adopt(token);
    return cache.tokens.active?.token === token.token ? token.token : null;
  }

  return {
    ready: () => loaded,
    async key() {
      await loaded;
      return key;
    },
    isSignedIn: () => key !== null,
    scope: () => (key !== null && tenant !== null ? `tenant:${tenant}` : null),
    tenantId: () => tenant,
    userId: () => user,
    async signIn(input) {
      await loaded;
      if (!deps.vault) throw new Error('The editor credential vault is unavailable');
      const credential = await deps.vault.wrap(input.accessKey);
      identityEpoch += 1;
      loadSequence += 1;
      key = input.accessKey;
      tenant = input.tenantId;
      user = null; // a new key may be another person's - relearned on the next exchange
      cache.clear();
      exchanges.clear();
      await deps.storage.set(KEY, credential);
      await Promise.all([deps.storage.remove(USER), input.tenantId === null ? deps.storage.remove(TENANT) : deps.storage.set(TENANT, input.tenantId)]);
      notify();
    },
    async signOut() {
      const old = key;
      await clear();
      if (old) await revokeKey(deps, old);
    },
    async switchWorkspace(target) {
      await loaded;
      if (!Number.isSafeInteger(target) || target <= 0) return false;
      return (await exchanges.run(`switch:${target}`, () => mintAndAdopt(target))) !== null;
    },
    async baseJwt() {
      await loaded;
      return exchanges.run('base', async () => (await mint(null))?.token ?? null);
    },
    async jwt(force = false) {
      await loaded;
      if (!key) return null;
      const cached = !force && cache.fresh('active');
      if (cached) return cached.token;
      const target = tenant;
      return exchanges.run(`workspace:${target}:${force ? 'force' : 'cached'}`, () => mintAndAdopt(target));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
