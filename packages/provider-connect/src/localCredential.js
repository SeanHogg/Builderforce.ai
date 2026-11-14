/**
 * The LOCAL CREDENTIAL — a connected subscription's short-lived access token, handed to a
 * runtime on the person's own machine so it can call the provider directly.
 *
 *   POST /llm/provider-keys/:provider/local-credential   [{ rejected }]
 *     200 { provider, runtime, accessToken, expiresAt (epoch ms), baseUrl, models[] }
 *     404 { code: 'provider_not_connected' }       → connect first
 *     409 { code: 'provider_reconnect_required' }  → the stored grant is dead; connect again
 *
 * Why the machine and not the gateway: some providers refuse our cloud egress outright
 * (Kimi's edge answers the Workers ASN with an HTML 403 before it reads a credential),
 * and the personal interactive client such a subscription is licensed for is exactly the
 * editor or browser the person is sitting at.
 *
 * Why the gateway still OWNS the grant: Kimi rotates its refresh token on every grant.
 * Two refreshers of one grant — the server and a laptop, or two laptops — means one of
 * them is always holding a retired token. So the server stays the single refresher and a
 * client only ever receives the access token, never the refresh token. That is also what
 * makes persisting it locally safe: the worst a leaked cache entry buys is fifteen minutes.
 *
 * `rejected` is the token the provider just refused (401) although our clock says it is still
 * live — a second sign-in on the same account revoked it early. The gateway then rotates the
 * grant instead of handing the same dead token back.
 *
 * Persisted through an injected string store (the editor's SecretStorage, Rovr's
 * `chrome.storage.local`), so a restart reuses an unexpired token instead of a round trip.
 */
import { errorDetail, field, stringField } from './port.js';
/** One fetch, decided. Never throws. `rejected`: see the module comment. */
export async function fetchLocalCredential(request, provider, rejected) {
    let res;
    try {
        res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/local-credential`, {
            method: 'POST',
            ...(rejected ? { json: { rejected } } : {}),
        });
    }
    catch (error) {
        return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
    }
    if (res.status === 404 && stringField(res.body, 'code') === 'provider_not_connected')
        return { kind: 'not_connected' };
    if (res.status === 409)
        return { kind: 'reconnect', detail: errorDetail(res.body, res.status) };
    if (res.status !== 200)
        return { kind: 'unavailable', detail: errorDetail(res.body, res.status) };
    const credential = parseLocalCredential(res.body);
    return credential ? { kind: 'credential', credential } : { kind: 'unavailable', detail: 'malformed local credential' };
}
/** Read a credential off the wire OR out of the store — the ONE parser for both. */
export function parseLocalCredential(body) {
    const accessToken = stringField(body, 'accessToken');
    const baseUrl = stringField(body, 'baseUrl');
    const expiresAt = Number(field(body, 'expiresAt'));
    if (!accessToken || !baseUrl || !Number.isFinite(expiresAt))
        return null;
    const rawModels = field(body, 'models');
    const models = (Array.isArray(rawModels) ? rawModels : []).flatMap((entry) => {
        const model = stringField(entry, 'model');
        if (!model)
            return [];
        const contextWindow = Number(field(entry, 'contextWindow'));
        return [{
                model,
                displayName: stringField(entry, 'displayName') || model,
                ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
            }];
    });
    return {
        provider: stringField(body, 'provider'),
        runtime: stringField(body, 'runtime'),
        accessToken,
        expiresAt,
        baseUrl,
        models,
    };
}
/**
 * Re-fetch once less than this much life remains. Two minutes covers a slow first byte
 * plus a long streamed turn on a fifteen-minute token without refreshing on every call.
 */
export const LOCAL_CREDENTIAL_REFRESH_MARGIN_MS = 2 * 60 * 1000;
export function createLocalCredentialStore(deps) {
    const key = `builderforce.localCredential.${deps.provider}`;
    let current = null;
    let inFlight = null;
    const listeners = new Set();
    const notify = () => listeners.forEach((listener) => listener());
    const usable = (credential) => credential !== null && credential.expiresAt - deps.now() > LOCAL_CREDENTIAL_REFRESH_MARGIN_MS;
    const persist = async (credential) => {
        // Unchanged ⇒ no write and no notify. A listener typically re-renders a host surface, and
        // that surface may resolve again — "not connected" persisted over "not connected" used to
        // notify every time and looped the editor's panel, resetting its model pick.
        const unchanged = credential === null
            ? current === null
            : current !== null && current.accessToken === credential.accessToken && current.expiresAt === credential.expiresAt;
        if (unchanged)
            return;
        current = credential;
        try {
            if (credential)
                await deps.store.set(key, JSON.stringify(credential));
            else
                await deps.store.delete(key);
        }
        catch {
            // The token in hand is still valid; a failed write only costs a round trip later.
        }
        notify();
    };
    const fetchFresh = async (rejected) => {
        const outcome = await fetchLocalCredential(deps.request, deps.provider, rejected);
        if (outcome.kind === 'credential')
            await persist(outcome.credential);
        // A definite "not connected" / "reconnect" retires what we held; "unavailable" (offline,
        // a gateway blip) does not — the persisted token may well still work.
        else if (outcome.kind !== 'unavailable')
            await persist(null);
        return outcome;
    };
    return {
        async resolve(options) {
            // A refusal of a token we no longer hold is already answered by the one we hold now.
            const rejected = options?.rejected && options.rejected === current?.accessToken ? options.rejected : undefined;
            if (!rejected && usable(current))
                return { kind: 'credential', credential: current };
            if (!inFlight)
                inFlight = fetchFresh(rejected).finally(() => { inFlight = null; });
            return inFlight;
        },
        snapshot: () => current,
        async hydrate() {
            let raw;
            try {
                raw = await deps.store.get(key);
            }
            catch {
                raw = null;
            }
            if (!raw)
                return;
            try {
                current = parseLocalCredential(JSON.parse(raw));
            }
            catch {
                current = null;
            }
            notify();
        },
        clear: () => persist(null),
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
//# sourceMappingURL=localCredential.js.map