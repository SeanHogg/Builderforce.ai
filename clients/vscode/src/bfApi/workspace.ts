import type * as vscode from "vscode";
import { isManagerRole } from "@seanhogg/builderforce-brain-embedded";
import { exchangeJwt, onSessionChange, signedInTenantId } from "./session";
import { authed } from "./transport";

// The signed-in human's user id (from GET /api/vscode/me), cached for the session so
// the "assigned to me" task filter doesn't refetch. `null` = resolved-but-unavailable
// (older API); undefined = not yet fetched. Cleared on sign-out via clearJwt.
let currentUserId: string | null | undefined;

/**
 * The signed-in user's id — for the "Assigned to me" task filter. Cached; returns
 * null when the identity endpoint isn't reachable (older API), so the caller can
 * degrade the filter to a no-op rather than hide everything.
 */
export async function getCurrentUserId(secrets: vscode.SecretStorage): Promise<string | null> {
  if (currentUserId !== undefined) return currentUserId;
  try {
    const r = await authed<{ userId?: string }>(secrets, "/api/vscode/me");
    currentUserId = r?.userId ?? null;
  } catch {
    currentUserId = null;
  }
  return currentUserId;
}

// The active workspace's {id, name}, cached until the workspace changes / sign-out.
let workspaceCache: { id: number; name: string } | undefined;

// Dropped on a workspace switch and on sign-out; the user id only on sign-out.
onSessionChange((change) => {
  workspaceCache = undefined;
  if (change === "reset") currentUserId = undefined;
});

/**
 * The workspace (tenant) the editor is currently acting as — for the sidebar header.
 * Resolves the active tenant id (selected or the key's own), then its name from the
 * user's workspace list (new endpoint) or `GET /api/tenants/:id` (works on older APIs).
 * Returns undefined when signed out or the name can't be resolved.
 */
export async function getCurrentWorkspace(
  secrets: vscode.SecretStorage,
): Promise<{ id: number; name: string } | undefined> {
  const token = await exchangeJwt(secrets);
  const id = signedInTenantId();
  if (!token || id === undefined) return undefined;
  if (workspaceCache && workspaceCache.id === id) return workspaceCache;

  let name: string | undefined;
  try {
    name = (await listWorkspaces(secrets)).find((w) => w.id === id)?.name;
  } catch {
    /* workspace list unavailable — fall back below */
  }
  if (!name) {
    try {
      name = (await authed<{ name?: string }>(secrets, `/api/tenants/${id}`))?.name;
    } catch {
      /* ignore — header just stays empty */
    }
  }
  if (!name) return undefined;
  workspaceCache = { id, name };
  return workspaceCache;
}

/**
 * Whether the signed-in user can manage the active workspace (owner/admin/manager) —
 * a best-effort UX gate for the Evermind console's write controls. Resolved from the
 * workspace list's `role`; the API enforces authoritatively regardless, so a false
 * negative just shows disabled controls (never a security hole). Degrades to false
 * when the role can't be resolved (signed out / older API).
 */
export async function canManageActiveWorkspace(secrets: vscode.SecretStorage): Promise<boolean> {
  try {
    const token = await exchangeJwt(secrets);
    const id = signedInTenantId();
    if (!token || id === undefined) return false;
    const role = (await listWorkspaces(secrets)).find((w) => w.id === id)?.role;
    return isManagerRole(role);
  } catch {
    return false;
  }
}

/** A workspace (tenant) the signed-in user belongs to. */
export interface BfWorkspace {
  id: number;
  name: string;
  role?: string;
}

/**
 * The user's workspaces (GET /api/tenants — person-level, accepts this editor's
 * workspace token). Throws on failure — the caller falls back to the web
 * onboarding deep-link.
 */
export async function listWorkspaces(secrets: vscode.SecretStorage): Promise<BfWorkspace[]> {
  const r = await authed<{ tenants: BfWorkspace[] }>(secrets, "/api/tenants");
  return r?.tenants ?? [];
}

/** Create a workspace (tenant); the caller becomes its owner. */
export async function createWorkspace(
  secrets: vscode.SecretStorage,
  name: string,
): Promise<BfWorkspace> {
  const t = await authed<BfWorkspace>(secrets, "/api/tenants", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!t) throw new Error("not signed in");
  return t;
}
