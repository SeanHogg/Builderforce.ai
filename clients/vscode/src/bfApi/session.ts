import * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "../gateway";
import { setOutboxScope, trackReachability } from "../outboxStorage";

/**
 * Client for BuilderForce's tenant APIs (projects/tasks/connection). The extension holds
 * a `bfk_*` gateway key, which only reaches `/llm/*`; this exchanges it for a short-lived
 * tenant JWT (cached) so it can call `/api/projects`, `/api/tasks`, `/api/vscode/*`.
 * All calls degrade gracefully (return empty / false) when the backend lacks these
 * endpoints (i.e. not yet deployed).
 */
// The editor key is bound to ONE tenant; its exchange yields the "base" JWT. To act on
// another of the user's workspaces we re-scope that base JWT to the selected tenant via
// /api/vscode/tenants/:id/token. Both tokens are cached with their tenant + expiry.
let baseJwt: { token: string; exp: number; tenantId: number } | undefined;
let scopedJwt: { token: string; exp: number; tenantId: number } | undefined;
let selectedTenantId: number | undefined;
let rescopeUnsupported = false; // set once the switch endpoint 404s (not deployed) — stop retrying

/** Set the active workspace (tenant) to act as. `undefined` = the key's own tenant. */
export function setSelectedWorkspace(tenantId: number | undefined): void {
  if (tenantId === selectedTenantId) return;
  selectedTenantId = tenantId;
  scopedJwt = undefined; // re-derive on next call
  notifySessionChange("workspace");
  syncOutboxScope();
}

/** What changed under the per-session caches that other modules hold. */
export type SessionChange = "workspace" | "reset";
const sessionListeners: Array<(change: SessionChange) => void> = [];

/**
 * Register a cache to be dropped when the session moves: `workspace` = the active
 * workspace switched, `reset` = signed out / re-keyed ({@link clearJwt}). Lets the
 * modules that own those caches (workspace identity, the Evermind head) stay out of
 * this one's imports.
 */
export function onSessionChange(listener: (change: SessionChange) => void): void {
  sessionListeners.push(listener);
}

function notifySessionChange(change: SessionChange): void {
  for (const listener of sessionListeners) listener(change);
}

/**
 * The tenant the editor is acting as once signed in — the selected workspace, else the
 * key's own tenant. `undefined` until the key's base token has been minted.
 */
export function signedInTenantId(): number | undefined {
  return baseJwt ? selectedTenantId ?? baseJwt.tenantId : undefined;
}

/**
 * The tenant calls actually act as: the selected workspace, unless re-scoping is not
 * deployed (then the key's own tenant). `undefined` until known.
 */
function effectiveTenantId(): number | undefined {
  if (!baseJwt) return selectedTenantId;
  return rescopeUnsupported ? baseJwt.tenantId : selectedTenantId ?? baseJwt.tenantId;
}

/** The workspace (tenant) `/api/*` calls act as right now — undefined until signed in.
 *  What a local chat binds into (PRD 36, `chatAccount.ts`). */
export function workspaceTenantId(): number | undefined {
  return baseJwt ? effectiveTenantId() : undefined;
}

/** Tell the durable outboxes which tenants writes now go to (see `outboxStorage.ts`). */
function syncOutboxScope(): void {
  setOutboxScope({ workspace: effectiveTenantId(), key: baseJwt?.tenantId });
}

/**
 * Re-scoping to the selected workspace failed in a way that falls back to the key's own
 * token: workspace writes PARK (they were queued for the selected tenant and must not
 * land in the key's) until a re-scope succeeds; gateway writes carry on.
 */
function parkWorkspaceWrites(): void {
  setOutboxScope({ workspace: undefined, key: baseJwt?.tenantId });
}

/** The tenant a token we minted acts as, or undefined when it is not one of ours. */
export function tenantOfToken(token: string): number | undefined {
  if (scopedJwt?.token === token) return scopedJwt.tenantId;
  if (baseJwt?.token === token) return baseJwt.tenantId;
  return undefined;
}

/**
 * Fired with the refused key when the gateway REJECTS the stored editor key (revoked,
 * deleted, or a key with no user behind it). Distinct from "unreachable": a rejection is
 * a verdict on the key, so the editor must stop presenting itself as signed in — see
 * `editorKeyGuard.ts`.
 */
const editorKeyRejected = new vscode.EventEmitter<string>();
export const onEditorKeyRejected = editorKeyRejected.event;

type KeyExchange =
  | { ok: true; jwt: { token: string; exp: number; tenantId: number } }
  | { ok: false; rejected: boolean };

/** One `tenant-api-key-token` round trip, classified — no caching, no side effects. */
async function requestBaseJwt(key: string): Promise<KeyExchange> {
  try {
    const res = await trackReachability(fetch(`${getBaseUrl()}/api/auth/tenant-api-key-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    }));
    // 401 = invalid/revoked key; 400 = a key with no user (the route says "use device
    // sign-in"). Anything else non-OK is the gateway, not the key.
    if (res.status === 401 || res.status === 400) return { ok: false, rejected: true };
    if (!res.ok) return { ok: false, rejected: false };
    const body = (await res.json()) as { token?: string; expiresIn?: number; tenantId?: number };
    if (!body.token || typeof body.tenantId !== "number") return { ok: false, rejected: false };
    return { ok: true, jwt: { token: body.token, exp: Date.now() + (body.expiresIn ?? 3600) * 1000, tenantId: body.tenantId } };
  } catch {
    return { ok: false, rejected: false };
  }
}

/** Exchange the stored editor key for its OWN tenant JWT (the key's bound workspace). */
async function exchangeBaseJwt(
  secrets: vscode.SecretStorage,
  force: boolean,
): Promise<{ token: string; tenantId: number } | undefined> {
  if (!force && baseJwt && Date.now() < baseJwt.exp - 60_000) return baseJwt;
  const epoch = jwtEpoch;
  const key = await getApiKey(secrets);
  if (!key) return undefined;
  const result = await requestBaseJwt(key);
  // Signed out or re-keyed meanwhile: this token belongs to the identity that left.
  if (epoch !== jwtEpoch) return undefined;
  if (!result.ok) {
    if (result.rejected) editorKeyRejected.fire(key);
    return undefined;
  }
  baseJwt = result.jwt;
  syncOutboxScope();
  return baseJwt;
}

/**
 * Does the stored editor key still work? `none` = no key; `rejected` = the gateway
 * refused it; `unreachable` = no verdict (offline / gateway error). Does NOT fire
 * {@link onEditorKeyRejected} — the sign-in flow probes and handles the answer itself.
 */
export async function probeEditorKey(
  secrets: vscode.SecretStorage,
): Promise<"ok" | "rejected" | "unreachable" | "none"> {
  const key = await getApiKey(secrets);
  if (!key) return "none";
  const result = await requestBaseJwt(key);
  if (result.ok) {
    baseJwt = result.jwt;
    syncOutboxScope();
    return "ok";
  }
  return result.rejected ? "rejected" : "unreachable";
}

/**
 * The exchange in flight, per mode: a burst of reads on a cold cache, or of 401s (a
 * panel's parallel reads), shares one mint instead of one each.
 */
const exchanges: { cached?: Promise<string | undefined>; forced?: Promise<string | undefined> } = {};
/** Bumped by {@link clearJwt}: an exchange that started before it does not write its token. */
let jwtEpoch = 0;

export function exchangeJwt(secrets: vscode.SecretStorage, force = false): Promise<string | undefined> {
  const mode = force ? "forced" : "cached";
  const running = exchanges[mode];
  if (running) return running;
  const next = mintJwt(secrets, force).finally(() => { if (exchanges[mode] === next) delete exchanges[mode]; });
  exchanges[mode] = next;
  return next;
}

async function mintJwt(secrets: vscode.SecretStorage, force: boolean): Promise<string | undefined> {
  const base = await exchangeBaseJwt(secrets, force);
  if (!base) return undefined;
  const target = selectedTenantId ?? base.tenantId;
  if (target === base.tenantId || rescopeUnsupported) return base.token;
  if (!force && scopedJwt && scopedJwt.tenantId === target && Date.now() < scopedJwt.exp - 60_000) {
    return scopedJwt.token;
  }
  // Re-scope to another of the user's workspaces. Degrades to the base token: 404 =
  // endpoint not deployed (latch off), 403 = no longer a member (drop the selection).
  try {
    const res = await fetch(`${getBaseUrl()}/api/vscode/tenants/${target}/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${base.token}`, "content-type": "application/json" },
    });
    if (res.status === 404) {
      rescopeUnsupported = true;
      syncOutboxScope();
      return base.token;
    }
    if (res.status === 403) {
      selectedTenantId = base.tenantId;
      syncOutboxScope();
      return base.token;
    }
    if (!res.ok) {
      parkWorkspaceWrites();
      return base.token;
    }
    const body = (await res.json()) as { token?: string; expiresIn?: number };
    if (!body.token) {
      parkWorkspaceWrites();
      return base.token;
    }
    scopedJwt = { token: body.token, exp: Date.now() + (body.expiresIn ?? 3600) * 1000, tenantId: target };
    syncOutboxScope();
    return scopedJwt.token;
  } catch {
    parkWorkspaceWrites();
    return base.token;
  }
}

export function clearJwt(): void {
  jwtEpoch++;
  delete exchanges.cached;
  delete exchanges.forced;
  baseJwt = undefined;
  scopedJwt = undefined;
  rescopeUnsupported = false;
  // Signed out (or re-keying): durable writes hold until the next identity is known.
  setOutboxScope({ workspace: undefined, key: undefined });
  notifySessionChange("reset");
}

/** The tenant JWT for embedding web pages (handed to the iframe via postMessage). */
export function getTenantJwt(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return exchangeJwt(secrets);
}

/**
 * A FRESH tenant JWT, for a caller the gateway just answered 401. The cached token is
 * still unexpired by the client's clock, so {@link getTenantJwt} would hand back the very
 * token the server rejected — a webview "re-mint" that re-sent it on every read.
 */
export function refreshTenantJwt(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return exchangeJwt(secrets, true);
}
