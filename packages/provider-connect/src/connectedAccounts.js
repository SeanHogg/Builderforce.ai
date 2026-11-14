/**
 * The workspace's CONNECTED ACCOUNTS as a client on the person's own machine uses them — the
 * ONE implementation every client shares (the editor and Rovr).
 *
 * A provider whose edge refuses our cloud (Kimi) is called from the client itself, with the
 * short-lived access token the gateway issues from the workspace's connection. This owns the
 * whole client side of that:
 *
 *  - one credential store per provider, created on FIRST USE and hydrated before its first
 *    resolve — so no host has an init step to forget (the editor once never ran its, and every
 *    Kimi turn failed "credentials are not initialized" with no sign-in offered);
 *  - resolving a pick (`local/kimi-code/k3`, `direct/kimi-code/k3`) or a runtime to the
 *    endpoint it is called at, through the runtime registry (`accountProvider`).
 *
 * A host adds only its own UX for a `connect` outcome (a notification, a Connect card) and its
 * own gate (Rovr's origin permission). Kept on its own subpath because it reads the runtime
 * registry, which the web settings card — a consumer of the root entry — never needs.
 */
import { LOCAL_RUNTIMES, clientPinOf, formatLocalModelRef, localRuntime, } from '@builderforce/local-inference';
import { createLocalCredentialStore } from './localCredential.js';
export function createConnectedAccounts(deps) {
    const stores = new Map();
    const store = (provider) => {
        const existing = stores.get(provider);
        if (existing)
            return existing;
        const created = createLocalCredentialStore({ request: deps.request, provider, store: deps.store, now: deps.now });
        if (deps.onChange)
            created.subscribe(deps.onChange);
        // Hydrate before the first resolve, so a token persisted by an earlier session is reused
        // rather than raced by a network fetch that a late hydrate would then overwrite.
        const hydrated = created.hydrate();
        const ready = { ...created, resolve: async (options) => { await hydrated; return created.resolve(options); } };
        stores.set(provider, ready);
        return ready;
    };
    const credentialFor = (provider) => async (rejected) => {
        const outcome = await store(provider).resolve(rejected ? { rejected } : undefined);
        return outcome.kind === 'credential' ? outcome.credential.accessToken : null;
    };
    const providerFor = (runtime) => localRuntime(runtime).accountProvider ?? null;
    const endpointFor = async (runtime) => {
        const provider = providerFor(runtime);
        if (!provider)
            return null;
        const outcome = await store(provider).resolve();
        switch (outcome.kind) {
            case 'credential':
                return {
                    kind: 'endpoint',
                    provider,
                    endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken, credential: credentialFor(provider) },
                };
            case 'not_connected':
                return { kind: 'connect', provider, reason: 'not_connected' };
            case 'reconnect':
                return { kind: 'connect', provider, reason: 'reconnect', detail: outcome.detail };
            default:
                return { kind: 'unavailable', provider, detail: outcome.detail };
        }
    };
    /** Providers already asked this session — a store with no credential after that is
     *  not connected, and is not asked again until a credential arrives. */
    const asked = new Set();
    const hybridAccount = async (runtime) => {
        const provider = runtime.accountProvider;
        if (!provider)
            return [];
        const held = store(provider);
        if (!held.snapshot() && asked.has(provider))
            return [];
        asked.add(provider);
        const outcome = await held.resolve();
        if (outcome.kind !== 'credential')
            return [];
        const lead = outcome.credential.models[0];
        if (!lead)
            return [];
        return [{
                ref: formatLocalModelRef(runtime.id, lead.model),
                provider: runtime.id,
                model: lead.model,
                endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken, credential: credentialFor(provider) },
            }];
    };
    const providers = [...new Set(LOCAL_RUNTIMES.flatMap((r) => (r.accountProvider ? [r.accountProvider] : [])))];
    return {
        providers,
        hydrate: async () => { await Promise.all(providers.map((p) => store(p).hydrate())); },
        store,
        credentialFor,
        providerFor,
        endpointFor,
        async pinFor(ref) {
            const pin = clientPinOf(ref);
            if (!pin)
                return null;
            const outcome = await endpointFor(pin.provider);
            return outcome ? { ...outcome, model: pin.model } : null;
        },
        hybridAccounts: async () => (await Promise.all(LOCAL_RUNTIMES.map(hybridAccount))).flat(),
        clear: async () => {
            asked.clear();
            await Promise.all([...stores.values()].map((s) => s.clear()));
        },
    };
}
//# sourceMappingURL=connectedAccounts.js.map