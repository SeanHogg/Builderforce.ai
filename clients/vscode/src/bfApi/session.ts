import * as vscode from "vscode";
import { createEditorSessionCache, createEditorSessionFlights, exchangeEditorKey, resolveEditorWorkspaceToken } from "@builderforce/device-auth";
import { getApiKey, getBaseUrl } from "../gateway/gateway";
import { setOutboxScope, trackReachability } from "../sync/outboxStorage";
import { setCurrentWorkspace } from "../workspace/workspaceSelection";
import { classifyWorkspaceRefusal, reportWorkspaceRefusal } from "../auth/gatewayAuth";

/**
 * Client for BuilderForce's tenant APIs (projects/tasks/connection). The extension holds
 * a `bfk_*` gateway key, which only reaches `/llm/*`; this exchanges it for a short-lived
 * tenant JWT (cached) so it can call `/api/projects`, `/api/tasks`, `/api/vscode/*`.
 * All calls degrade gracefully (return empty / false) when the backend lacks these
 * endpoints (i.e. not yet deployed).
 */
// The editor key is bound to ONE tenant; its exchange yields the "base" JWT. To act on
// another of the user's workspaces we re-scope that base JWT to the selected tenant via
// /api/auth/workspace-token. Both tokens are cached with their tenant + expiry.
const cache = createEditorSessionCache(Date.now);
const tokens = cache.tokens;
let selectedTenantId: number | undefined;

/** Set the active workspace (tenant) to act as. `undefined` = the key's own tenant. */
export function setSelectedWorkspace(tenantId: number | undefined): void {
  if (tenantId === selectedTenantId) return;
  selectedTenantId = tenantId;
  tokens.active = undefined; // re-derive on next call
  // A mint in flight resolved the OLD selection: the next call must start its own.
  exchanges.clear();
  notifySessionChange("workspace");
  syncOutboxScope();
}

const droppedListeners: Array<(droppedTenantId: number) => void> = [];

/**
 * Register what must follow when the selected workspace is dropped because the user is no
 * longer a member (persist the cleared selection, refresh the views, tell the person).
 * Registered once by the extension; the session module holds no globalState or UI.
 */
export function onWorkspaceDropped(listener: (droppedTenantId: number) => void): () => void {
  droppedListeners.push(listener);
  return () => {
    const at = droppedListeners.indexOf(listener);
    if (at >= 0) droppedListeners.splice(at, 1);
  };
}

/**
 * THE way a selected workspace is dropped because it is no longer available to this person:
 * the `/api` re-scope was refused (403) or the gateway said `workspace_not_member`. Clears
 * the selection (the key's own workspace takes over) and notifies {@link onWorkspaceDropped}
 * listeners. A no-op when nothing is selected. `refused` is the workspace the refusal was
 * ABOUT; when given, the drop applies only if that is still the selection (an answer for a
 * workspace the person has since left must not drop the one they chose after).
 */
export function dropWorkspaceSelection(refused?: number): void {
  const dropped = selectedTenantId;
  if (dropped === undefined || (refused !== undefined && refused !== dropped)) return;
  setSelectedWorkspace(undefined);
  for (const listener of droppedListeners) listener(dropped);
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
 * The tenant the editor is acting as once signed in â€” the selected workspace, else the
 * key's own tenant. `undefined` until the key's base token has been minted.
 */
export function signedInTenantId(): number | undefined {
  return tokens.base ? selectedTenantId ?? tokens.base.tenantId : undefined;
}

/** The tenant calls are meant to act as: the selected workspace, else the key's own. `undefined` until known. */
function effectiveTenantId(): number | undefined {
  if (!tokens.base) return selectedTenantId;
  return selectedTenantId ?? tokens.base.tenantId;
}

/** The workspace (tenant) `/api/*` calls act as right now â€” undefined until signed in.
 *  What a local chat binds into (PRD 36, `chatAccount.ts`). */
export function workspaceTenantId(): number | undefined {
  return tokens.base ? effectiveTenantId() : undefined;
}

/**
 * The token a frame may carry, bound to the tenant it ACTS as. A parked re-scope hands
 * back the key tenant's base token while the workspace says another: tagging that one with
 * the workspace's id would send direct webview writes to the wrong tenant. Fails closed
 * (null) when the token is not one we minted for the current workspace.
 */
export function boundToken(token: string | undefined): { token: string; tenantId: number } | null {
  const tenantId = token ? tenantOfToken(token) : undefined;
  return tenantId !== undefined && tenantId === workspaceTenantId() ? { token: token!, tenantId } : null;
}

/**
 * The tenant durable writes may replay into: one we HOLD a token for. The key's own tenant
 * once its base token is minted; a selected other workspace only once its re-scoped token
 * is. Until then (and after any refused re-scope) writes stay parked, so a write queued for
 * workspace B can never ride the key tenant's token into tenant A.
 */
function outboxTenantId(): number | undefined {
  if (!tokens.base) return undefined;
  if (selectedTenantId === undefined || selectedTenantId === tokens.base.tenantId) return tokens.base.tenantId;
  return tokens.active?.tenantId === selectedTenantId ? selectedTenantId : undefined;
}

/** Tell the durable outboxes which tenants writes now go to (see `outboxStorage.ts`). */
function syncOutboxScope(): void {
  setOutboxScope({ workspace: outboxTenantId() });
  // The gateway names this workspace on its calls (`gatewayAuth.ts` reads the leaf).
  setCurrentWorkspace(effectiveTenantId());
}

/**
 * Re-scoping to the selected workspace failed in a way that falls back to the key's own
 * token: workspace writes PARK (they were queued for the selected tenant and must not
 * land in the key's) until a re-scope succeeds. The re-scoped token is dropped too, so a
 * later base re-mint ({@link syncOutboxScope}) cannot un-park them on a token we no longer
 * hand out.
 */
function parkWorkspaceWrites(): void {
  tokens.active = undefined;
  setOutboxScope({ workspace: undefined });
}

/** The tenant a token we minted acts as, or undefined when it is not one of ours. */
export function tenantOfToken(token: string): number | undefined {
  if (tokens.active?.token === token) return tokens.active.tenantId;
  if (tokens.base?.token === token) return tokens.base.tenantId;
  return undefined;
}

/**
 * Fired with the refused key when the gateway REJECTS the stored editor key (revoked,
 * deleted, or a key with no user behind it). Distinct from "unreachable": a rejection is
 * a verdict on the key, so the editor must stop presenting itself as signed in â€” see
 * `editorKeyGuard.ts`.
 */
const editorKeyRejected = new vscode.EventEmitter<string>();
export const onEditorKeyRejected = editorKeyRejected.event;

function requestBaseJwt(key: string) {
  return exchangeEditorKey(getBaseUrl(), key, (url, init) => trackReachability(fetch(url, init)), Date.now);
}

/** Exchange the stored editor key for its OWN tenant JWT (the key's bound workspace). */
async function exchangeBaseJwt(
  secrets: vscode.SecretStorage,
  force: boolean,
): Promise<{ token: string; tenantId: number } | undefined> {
  const cached = !force && cache.fresh("base");
  if (cached) return cached;
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
  tokens.base = result.jwt;
  syncOutboxScope();
  return tokens.base;
}

/**
 * Does the stored editor key still work? `none` = no key; `rejected` = the gateway
 * refused it; `unreachable` = no verdict (offline / gateway error). Does NOT fire
 * {@link onEditorKeyRejected} â€” the sign-in flow probes and handles the answer itself.
 */
export async function probeEditorKey(
  secrets: vscode.SecretStorage,
): Promise<"ok" | "rejected" | "unreachable" | "none"> {
  const epoch = jwtEpoch;
  const key = await getApiKey(secrets);
  if (!key) return "none";
  const result = await requestBaseJwt(key);
  if (epoch !== jwtEpoch) return "none";
  if (result.ok) {
    tokens.base = result.jwt;
    syncOutboxScope();
    return "ok";
  }
  return result.rejected ? "rejected" : "unreachable";
}

/**
 * The exchange in flight, per mode: a burst of reads on a cold cache, or of 401s (a
 * panel's parallel reads), shares one mint instead of one each.
 */
const exchanges = createEditorSessionFlights<string | undefined>();
/** Bumped by {@link clearJwt}: an exchange that started before it does not write its token. */
let jwtEpoch = 0;

export function exchangeJwt(secrets: vscode.SecretStorage, force = false): Promise<string | undefined> {
  const mode = force ? "forced" : "cached";
  return exchanges.run(mode, () => mintJwt(secrets, force));
}

async function mintJwt(secrets: vscode.SecretStorage, force: boolean): Promise<string | undefined> {
  const epoch = jwtEpoch;
  const base = await exchangeBaseJwt(secrets, force);
  if (!base) return undefined;
  const target = selectedTenantId ?? base.tenantId;
  if (target === base.tenantId) return base.token;
  const cached = !force && cache.fresh("active", target);
  if (cached) return cached.token;
  // Re-scope to another of the user's workspaces. Degrades to the base token:
  // 403 = no longer a member (drop the selection); any other refusal parks.
  const isCurrent = () => epoch === jwtEpoch && selectedTenantId === target;
  const result = await resolveEditorWorkspaceToken({
    baseUrl: getBaseUrl(),
    tenantId: target,
    baseToken: base.token,
    fetch,
    now: Date.now,
    isCurrent,
    refreshBase: () => exchangeBaseJwt(secrets, true),
  });
  if (!result || !isCurrent()) return undefined;
  if (result.state === "minted") {
    tokens.active = result.jwt;
    syncOutboxScope();
    return tokens.active.token;
  }
  if (result.state === "forbidden") {
    const refusal = classifyWorkspaceRefusal(403, result.error);
    if (refusal === "editor_key_required") {
      parkWorkspaceWrites();
      const key = await getApiKey(secrets);
      if (!isCurrent()) return undefined;
      if (key) reportWorkspaceRefusal(refusal, key, target);
    } else {
      dropWorkspaceSelection(target);
    }
  } else {
    parkWorkspaceWrites();
  }
  return result.baseToken;
}

export function clearJwt(): void {
  jwtEpoch++;
  exchanges.clear();
  cache.clear();
  // Signed out (or re-keying): durable writes hold until the next identity is known.
  setOutboxScope({ workspace: undefined });
  // The SELECTION survives a re-key: gateway calls keep naming it until the next exchange.
  // Only signing out (setSelectedWorkspace(undefined)) or a drop clears it.
  setCurrentWorkspace(selectedTenantId);
  notifySessionChange("reset");
}

/** The tenant JWT for embedding web pages (handed to the iframe via postMessage). */
export function getTenantJwt(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return exchangeJwt(secrets);
}

/**
 * A FRESH tenant JWT, for a caller the gateway just answered 401. The cached token is
 * still unexpired by the client's clock, so {@link getTenantJwt} would hand back the very
 * token the server rejected â€” a webview "re-mint" that re-sent it on every read.
 */
export function refreshTenantJwt(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return exchangeJwt(secrets, true);
}
