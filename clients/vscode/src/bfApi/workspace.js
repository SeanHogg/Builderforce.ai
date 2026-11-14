import { isManagerRole } from "@seanhogg/builderforce-brain-embedded";
import { exchangeJwt, onSessionChange, signedInTenantId } from "./session";
import { authed } from "./transport";
// The signed-in human's user id (from GET /api/vscode/me), cached for the session so
// the "assigned to me" task filter doesn't refetch. `null` = resolved-but-unavailable
// (older API); undefined = not yet fetched. Cleared on sign-out via clearJwt.
let currentUserId;
/** Who the signed-in human is by name (the same `/me` answer), for provenance on what they review. */
let currentUserName;
const IDENTITY_KEY = "builderforce.identityCache";
let identityStore;
export function bindIdentityCache(store) {
    identityStore = store;
}
function identitySessionKey() {
    return String(signedInTenantId() ?? "none");
}
async function loadIdentity(secrets) {
    const cached = identityStore?.memento.get(IDENTITY_KEY);
    const remembered = cached && cached.sessionKey === identitySessionKey() ? cached : undefined;
    if (identityStore?.offline()) {
        // Denied: nothing is attempted. Left unresolved (not cached as null) so the next online read fetches it.
        currentUserId = remembered?.userId ?? null;
        currentUserName = remembered?.displayName ?? null;
        if (!remembered) {
            currentUserId = undefined;
            currentUserName = undefined;
        }
        return;
    }
    try {
        const r = await authed(secrets, "/api/vscode/me", {
            asTenant: "any", // person-level: the signed-in user, identical under any workspace token
        });
        currentUserId = r?.userId ?? null;
        // The display name only: an email is never written into a pack a person shares.
        currentUserName = r?.displayName || null;
        if (currentUserId)
            void identityStore?.memento.update(IDENTITY_KEY, { sessionKey: identitySessionKey(), userId: currentUserId, displayName: currentUserName });
    }
    catch {
        currentUserId = null;
        currentUserName = null;
    }
}
/**
 * The signed-in user's id — for the "Assigned to me" task filter. Cached; returns
 * null when the identity endpoint isn't reachable (older API), so the caller can
 * degrade the filter to a no-op rather than hide everything.
 */
export async function getCurrentUserId(secrets) {
    if (currentUserId === undefined)
        await loadIdentity(secrets);
    return currentUserId ?? null;
}
/** The signed-in user's display name (never the email); null when signed out, unnamed, or the API predates it. Cached with the id. */
export async function getCurrentUserName(secrets) {
    if (currentUserName === undefined)
        await loadIdentity(secrets);
    return currentUserName ?? null;
}
// The active workspace's {id, name}, cached until the workspace changes / sign-out.
let workspaceCache;
// Dropped on a workspace switch and on sign-out; the user id only on sign-out.
onSessionChange((change) => {
    workspaceCache = undefined;
    if (change === "reset") {
        currentUserId = undefined;
        currentUserName = undefined;
        void identityStore?.memento.update(IDENTITY_KEY, undefined);
    }
});
/**
 * The workspace (tenant) the editor is currently acting as — for the sidebar header.
 * Resolves the active tenant id (selected or the key's own), then its name from the
 * user's workspace list (new endpoint) or `GET /api/tenants/:id` (works on older APIs).
 * Returns undefined when signed out or the name can't be resolved.
 */
export async function getCurrentWorkspace(secrets) {
    const token = await exchangeJwt(secrets);
    const id = signedInTenantId();
    if (!token || id === undefined)
        return undefined;
    if (workspaceCache && workspaceCache.id === id)
        return workspaceCache;
    let name;
    try {
        name = (await listWorkspaces(secrets)).find((w) => w.id === id)?.name;
    }
    catch {
        /* workspace list unavailable — fall back below */
    }
    if (!name) {
        try {
            name = (await authed(secrets, `/api/tenants/${id}`))?.name;
        }
        catch {
            /* ignore — header just stays empty */
        }
    }
    if (!name)
        return undefined;
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
export async function canManageActiveWorkspace(secrets) {
    return (await activeWorkspaceManager(secrets)) === true;
}
/**
 * The same manager-tier answer — the platform's approve/reject authority (`isManagerRole`, the API's `isManager`) — but
 * saying when it could NOT be read: undefined when signed out, or the workspace or its role cannot be resolved. For a
 * decision that must fail closed rather than read "unknown" as "no" (a held run's release, PRD 41 §12.5).
 */
export async function activeWorkspaceManager(secrets) {
    try {
        const token = await exchangeJwt(secrets);
        const id = signedInTenantId();
        if (!token || id === undefined)
            return undefined;
        const role = (await listWorkspaces(secrets)).find((w) => w.id === id)?.role;
        return role === undefined ? undefined : isManagerRole(role);
    }
    catch {
        return undefined;
    }
}
/**
 * The user's workspaces (GET /api/tenants — person-level, accepts this editor's
 * workspace token). Throws on failure — the caller falls back to the web
 * onboarding deep-link.
 */
export async function listWorkspaces(secrets) {
    const r = await authed(secrets, "/api/tenants", {
        asTenant: "any", // person-level list: the choices the selection is made from
    });
    return r?.tenants ?? [];
}
/** Create a workspace (tenant); the caller becomes its owner. */
export async function createWorkspace(secrets, name) {
    const t = await authed(secrets, "/api/tenants", {
        method: "POST",
        asTenant: "any", // creates a NEW workspace for the person; not acting inside any existing one
        body: JSON.stringify({ name }),
    });
    if (!t)
        throw new Error("not signed in");
    return t;
}
//# sourceMappingURL=workspace.js.map