import { authed } from "./transport";
import { getCurrentWorkspace } from "./workspace";
/**
 * List the tenant's configured BYO model providers.
 * Returns the providers that have credentials configured (API key or OAuth).
 */
export async function listByoProviders(secrets) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return [];
    try {
        // `providers` is the bare id array kept for older clients; the per-provider facts are
        // in `details`. Reading `providers` as objects (as this did) made every connection's
        // id `undefined`, so the editor offered to "add" providers that were already connected
        // and never showed how a connected one authenticates.
        const r = await authed(secrets, `/llm/provider-keys`);
        return (r?.details ?? []).map((d) => ({
            id: d.provider,
            label: d.provider,
            authType: d.authType ?? "api_key",
            isConnected: !d.authAlert,
            ...(d.authAlert ? { error: `${d.authAlert.reason ?? "rejected"} (HTTP ${d.authAlert.status ?? 0})` } : {}),
            hasApiKey: d.authType !== "oauth",
            hasOauth: d.authType === "oauth",
        }));
    }
    catch {
        return [];
    }
}
/**
 * Set an API key for a BYO provider.
 */
export async function setByoProviderKey(secrets, provider, apiKey) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    return authed(secrets, `/llm/provider-keys/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
    });
}
/**
 * Remove a BYO provider connection.
 */
export async function removeByoProvider(secrets, provider) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    return authed(secrets, `/llm/provider-keys/${provider}`, {
        method: "DELETE",
    });
}
/**
 * Test a BYO provider connection.
 */
export async function testByoProvider(secrets, provider) {
    const ws = await getCurrentWorkspace(secrets);
    if (!ws)
        return undefined;
    return authed(secrets, `/llm/provider-keys/${provider}/test`, {
        method: "POST",
    });
}
//# sourceMappingURL=byoProviders.js.map