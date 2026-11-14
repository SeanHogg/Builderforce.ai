import { createConnectedAccounts } from "@builderforce/provider-connect/accounts";
let accounts;
const listeners = new Set();
/** The editor's connected accounts, created on first use. */
export function connectedAccounts(secrets, request) {
    accounts ??= createConnectedAccounts({
        request: request(),
        store: {
            get: (key) => Promise.resolve(secrets.get(key)),
            set: (key, value) => Promise.resolve(secrets.store(key, value)),
            delete: (key) => Promise.resolve(secrets.delete(key)),
        },
        now: Date.now,
        onChange: () => listeners.forEach((listener) => listener()),
    });
    return accounts;
}
/** Told whenever a credential arrives or is dropped — a surface re-reads its model list. */
export function onLocalCredentialsChange(listener) {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
}
/** The last known credential's endpoint and models — synchronous, no I/O. Never send its
 *  token without `resolve()`: it may have expired. */
export function localCredentialSnapshot(provider) {
    return accounts?.store(provider).snapshot() ?? null;
}
/** Forget every locally held credential — sign-out, so the next account starts clean. */
export async function clearLocalProviderCredentials() {
    await accounts?.clear();
}
//# sourceMappingURL=localProviderCredentials.js.map