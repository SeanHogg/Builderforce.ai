import { authed, authedRaw } from "./transport";
import { getCurrentWorkspace } from "./workspace";
/** The workspace's registered MCP servers. `[]` when signed out or unreachable. */
export async function listMcpExtensions(secrets) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return [];
    const r = await authed(secrets, `/api/tenants/${ws.id}/mcp-extensions`);
    return r?.extensions ?? [];
}
/** Register an external MCP server for the active workspace (owner-only server-side). */
export async function createMcpExtension(secrets, input) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    return authed(secrets, `/api/tenants/${ws.id}/mcp-extensions`, {
        method: "POST",
        body: JSON.stringify(input),
    });
}
/**
 * Begin the three-legged OAuth connect for a registered server. Returns the
 * provider's authorize URL for the caller to open in a browser — the consent
 * screen is a top-level navigation and cannot be shown inside the editor.
 * `undefined` when the server needs no authorization (the API answers 409).
 */
export async function beginMcpOAuthConnect(secrets, extensionId) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    const r = await authedRaw(secrets, `/api/tenants/${ws.id}/mcp-extensions/${extensionId}/oauth/connect`);
    return r?.status === 200 ? r.body?.authUrl : undefined;
}
//# sourceMappingURL=mcpExtensions.js.map