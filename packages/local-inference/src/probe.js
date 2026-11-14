/**
 * What the runtimes on this machine serve RIGHT NOW, and what each model can do.
 *
 * A runtime that is not running is the NORMAL case — a developer with only Ollama still
 * opens the picker — so every failure (refused, wedged, non-OK, malformed) reads as "no
 * models" and the probe never throws. A short timeout keeps a wrong-port endpoint from
 * stalling the caller: this is localhost, where a healthy answer is immediate.
 *
 * `fetch` is injected, never the global: the same probe runs in the editor's Node host,
 * a web page and an MV3 service worker, and a test pins it without patching globals.
 */
import { formatLocalModelRef } from './ref.js';
import { localAuthHeaders, localModelsUrl, normalizeLocalBaseUrl } from './endpoint.js';
import { HTTP_LOCAL_RUNTIMES, LOCAL_RUNTIMES, localRuntime, } from './runtimes.js';
/**
 * May this row take a turn NOW? Absent `state` = a runtime that has no notion of one
 * (every HTTP runtime) = servable; otherwise only `ready`. THE filter every consumer of a
 * probe's `models` applies before routing, counting or shadowing by id.
 */
export function isServableLocalModel(m) {
    return m.state === undefined || m.state === 'ready';
}
/** The runtime's display name for a probed row: for a runtime that serves one
 *  vendor-named model (`labelFromProbe`) the row's own label ("Gemini Nano (Chrome)"),
 *  else the registry's brand label. A multi-model runtime's row label is a MODEL name and
 *  is never used as the runtime's. */
export function localModelLabel(row, runtimeId) {
    const runtime = localRuntime(runtimeId);
    return (runtime.labelFromProbe && row?.label) || runtime.label;
}
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
/** GET/POST JSON with a timeout. Never throws: `undefined` = no usable answer. */
async function fetchJson(fetchImpl, url, init, timeoutMs) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { ...init, signal: abort.signal });
        if (!res.ok)
            return undefined;
        return (await res.json());
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
/** `/v1/models` rows: string ids only (a numeric id is dropped, never pinned as "42"). */
function catalogRows(json) {
    const data = json?.data;
    if (!Array.isArray(data))
        return [];
    return data.flatMap((entry) => {
        const { id, owned_by } = (entry ?? {});
        if (typeof id !== 'string' || id.length === 0)
            return [];
        return [{ id, ...(typeof owned_by === 'string' ? { ownedBy: owned_by } : {}) }];
    });
}
/**
 * Ollama's per-model card (`POST /api/show`): `capabilities` (`completion`, `tools`,
 * `embedding`, …), `model_info["<arch>.context_length"]` — the TRAINED window, which
 * only caps the served one ({@link servedWindow}) — and the Modelfile's `num_ctx`
 * (`parameters`), which every request without options loads with. `undefined` = the runtime
 * gave no card (an older Ollama, or an Ollama-compatible server that lacks the route).
 */
export async function ollamaCard(fetchImpl, endpoint, model, timeoutMs) {
    const json = await fetchJson(fetchImpl, `${normalizeLocalBaseUrl(endpoint.baseUrl)}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...localAuthHeaders(endpoint) },
        body: JSON.stringify({ model, name: model }),
    }, timeoutMs);
    if (!json || typeof json !== 'object')
        return undefined;
    const { capabilities, model_info, parameters } = json;
    const caps = Array.isArray(capabilities) ? capabilities.filter((c) => typeof c === 'string') : undefined;
    let contextTokens;
    if (model_info && typeof model_info === 'object') {
        for (const [key, value] of Object.entries(model_info)) {
            if (key.endsWith('.context_length') && typeof value === 'number' && value > 0)
                contextTokens = value;
        }
    }
    const numCtx = typeof parameters === 'string' ? Number(/^\s*num_ctx\s+(\d+)\s*$/m.exec(parameters)?.[1]) : NaN;
    return {
        ...(caps ? { capabilities: caps } : {}),
        ...(contextTokens ? { contextTokens } : {}),
        ...(numCtx > 0 ? { numCtx } : {}),
    };
}
/**
 * The window Ollama loads a model with when nothing set one (`OLLAMA_CONTEXT_LENGTH`
 * unset, no Modelfile `num_ctx`). A model that is not loaded yet will load with this, so
 * it — not the trained length on the card — is the window a turn may plan on.
 */
const OLLAMA_DEFAULT_CONTEXT_TOKENS = 4_096;
/**
 * The windows Ollama is SERVING right now (`GET /api/ps` → `context_length` per loaded
 * model). The card's `<arch>.context_length` is what the weights were trained for (a
 * 256K Qwen3-Coder), while the runtime truncates a longer prompt to its loaded window
 * without an error — so a plan sized on the card hands it turns it silently mangles.
 */
async function ollamaLoadedWindows(fetchImpl, endpoint, timeoutMs) {
    const loaded = new Map();
    for (const entry of await ollamaLoadedModels(fetchImpl, endpoint, timeoutMs)) {
        if (!entry.contextLength)
            continue;
        for (const id of entry.ids)
            loaded.set(id, entry.contextLength);
    }
    return loaded;
}
/**
 * The models Ollama holds resident right now (`GET /api/ps`) — the ONE reader of that
 * route. Empty when none is loaded or the runtime is not answering. Never loads a model.
 */
export async function ollamaLoadedModels(fetchImpl, endpoint, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
    const json = await fetchJson(fetchImpl, `${normalizeLocalBaseUrl(endpoint.baseUrl)}/api/ps`, { headers: { accept: 'application/json', ...localAuthHeaders(endpoint) } }, timeoutMs);
    const models = json?.models;
    if (!Array.isArray(models))
        return [];
    return models.flatMap((entry) => {
        const { name, model, digest, context_length } = (entry ?? {});
        const ids = [name, model].filter((id) => typeof id === 'string' && id.length > 0);
        if (ids.length === 0)
            return [];
        return [{
                ids,
                ...(typeof digest === 'string' && digest.length > 0 ? { digest } : {}),
                ...(typeof context_length === 'number' && context_length > 0 ? { contextLength: context_length } : {}),
            }];
    });
}
/**
 * The model Ollama has RESIDENT right now (`GET /api/ps`), or undefined when none is
 * loaded or the runtime is not answering — what the tier-3 logprob port's `warm()` reads
 * (`residentModelTracker`). Asking never loads a model.
 */
export async function ollamaResidentModel(fetchImpl, endpoint, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
    const loaded = await ollamaLoadedWindows(fetchImpl, endpoint, timeoutMs);
    return loaded.keys().next().value;
}
/**
 * The window a probed Ollama model will serve OUR requests (OpenAI-compatible, so they
 * carry no `num_ctx`): the Modelfile's `num_ctx` when it sets one — exact, whoever
 * loaded the model — else its loaded window, else the default load window; never past
 * what it was trained for.
 *
 * The loaded window is the server's default only when a request like ours loaded it;
 * another client's `num_ctx` shows here too, and Ollama reloads at the default for our
 * request. No Ollama route reports that default (`OLLAMA_CONTEXT_LENGTH` lives in the
 * server's environment), so this is the closest reading the API allows.
 */
function servedWindow(card, loaded) {
    const window = card.numCtx ?? loaded ?? OLLAMA_DEFAULT_CONTEXT_TOKENS;
    return Math.min(window, card.contextTokens ?? window);
}
async function probeRuntime(fetchImpl, provider, endpoint, options) {
    const runtime = localRuntime(provider);
    const ownedBy = new Map();
    const json = await fetchJson(fetchImpl, localModelsUrl(endpoint.baseUrl), { headers: { accept: 'application/json', ...localAuthHeaders(endpoint) } }, options.timeoutMs);
    if (json === undefined)
        return { probe: { provider, endpoint, reachable: false, models: [] }, ownedBy };
    const rows = catalogRows(json);
    const loaded = runtime.tools === 'probe' && options.capabilities
        ? await ollamaLoadedWindows(fetchImpl, endpoint, options.timeoutMs)
        : new Map();
    const models = await Promise.all(rows.map(async ({ id, ownedBy: owner }) => {
        ownedBy.set(id, owner);
        const base = { ref: formatLocalModelRef(provider, id), provider, model: id };
        if (runtime.tools === 'all')
            return { ...base, tools: true };
        if (runtime.tools === 'unknown' || !options.capabilities)
            return base;
        const card = await ollamaCard(fetchImpl, endpoint, id, options.timeoutMs);
        if (!card)
            return base;
        // An embedding-only model cannot hold a conversation at all; offering it for a chat
        // turn is a guaranteed failure.
        if (card.capabilities && !card.capabilities.includes('completion') && card.capabilities.includes('embedding')) {
            return null;
        }
        return {
            ...base,
            ...(card.capabilities?.includes('tools') ? { tools: true } : {}),
            contextTokens: servedWindow(card, loaded.get(id)),
        };
    }));
    return {
        probe: { provider, endpoint, reachable: true, models: models.filter((m) => m !== null) },
        ownedBy,
    };
}
/**
 * Probe every PROBED runtime that has an endpoint, concurrently (localhost round trips
 * must not queue behind one another). A runtime with a blank or absent endpoint is not
 * contacted at all; a `declared` runtime (Kimi) is the host's to list, and a `page`
 * runtime (the browser's built-in model) has no HTTP surface to ask. Never throws.
 *
 * One de-duplication: a model whose `owned_by` names ANOTHER configured runtime is that
 * runtime's, not this one's — `bfi serve` on the Ollama port must not list each Synapse
 * model twice (once as `local/ollama/…`, once as `local/synapse/…`). When the owner is
 * not configured the row stays where it was found, so it remains servable.
 */
export async function probeLocalRuntimes(fetchImpl, endpoints, options = {}) {
    const resolved = {
        timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        capabilities: options.capabilities ?? false,
    };
    const targets = HTTP_LOCAL_RUNTIMES.filter((r) => r.catalog === 'probe' && (endpoints[r.id]?.baseUrl.trim().length ?? 0) > 0);
    const results = await Promise.all(targets.map((r) => probeRuntime(fetchImpl, r.id, endpoints[r.id], resolved)));
    const probed = new Set(targets.map((r) => r.id));
    return results.map(({ probe, ownedBy }) => ({
        ...probe,
        models: probe.models.filter((m) => {
            const owner = LOCAL_RUNTIMES.find((r) => r.ownedBy !== undefined && r.ownedBy === ownedBy.get(m.model));
            return !owner || owner.id === probe.provider || !probed.has(owner.id);
        }),
    }));
}
export function createLocalRuntimeProber(fetchImpl, config = {}) {
    const ttlMs = config.ttlMs ?? 15_000;
    const now = config.now ?? (() => Date.now());
    let memo;
    return {
        probe(endpoints, options = {}) {
            // Keyed on the endpoints (tokens included — this memo is in-process only), so a
            // settings change is a miss rather than a stale answer for the old URL.
            const key = JSON.stringify(LOCAL_RUNTIMES.map((r) => endpoints[r.id] ?? null));
            const at = now();
            if (!options.fresh && memo && memo.key === key && at - memo.at < ttlMs)
                return memo.value;
            const value = probeLocalRuntimes(fetchImpl, endpoints, config);
            memo = { key, at, value };
            return value;
        },
        invalidate() {
            memo = undefined;
        },
    };
}
//# sourceMappingURL=probe.js.map