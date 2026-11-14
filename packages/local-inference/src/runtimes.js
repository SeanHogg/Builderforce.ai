/**
 * The runtime REGISTRY — every runtime a client on the user's machine can drive
 * directly, as data.
 *
 * Membership means "the CLIENT performs this call itself", not "the weights are on this
 * disk". Six entries are on-device engines (Synapse's native `bfi`, Ollama, FreeToken,
 * and three engines inside the page: our `bfi` compiled to WebAssembly over WebGPU,
 * WebLLM, and the browser's own built-in model): no account, no metering, available
 * offline, and the only ones local-first routing will try. `kimi-code` is Kimi's hosted API and belongs here anyway: its edge
 * refuses a hosted gateway before reading a credential, while the identical request
 * from the developer's own machine is the personal client the subscription is licensed
 * for. Same mechanism, different reason — hence `onDevice`.
 *
 * Kept as DATA so a host never branches on a runtime id: the picker, the probe, the
 * plan and the catalog binding all read the fields below.
 */
/**
 * The non-routable roots the in-page engines' shim answers, one per page runtime.
 * `.local` never resolves to a real origin, so a request that somehow missed the shim
 * fails rather than leaving the page.
 */
export const BROWSER_ENGINE_BASE_URL = 'http://browser.local';
export const BFI_ENGINE_BASE_URL = 'http://bfi.local';
export const WEBLLM_ENGINE_BASE_URL = 'http://webllm.local';
/** Kimi Code's model ids → the catalog ids the price book knows them under (Moonshot's `kimi-*`). Both the
 *  short form a Kimi Code install lists (`k3`) and the full one (`kimi-k3`) resolve. */
const KIMI_CODE_CATALOG_ALIASES = {
    'k2': 'moonshotai/kimi-k2',
    'kimi-k2': 'moonshotai/kimi-k2',
    'kimi-k2-0905': 'moonshotai/kimi-k2-0905',
    'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
    'k2.5': 'moonshotai/kimi-k2.5',
    'kimi-k2.5': 'moonshotai/kimi-k2.5',
    'k2.6': 'moonshotai/kimi-k2.6',
    'kimi-k2.6': 'moonshotai/kimi-k2.6',
    'kimi-k2.7-code': 'moonshotai/kimi-k2.7-code',
    'k3': 'moonshotai/kimi-k3',
    'kimi-k3': 'moonshotai/kimi-k3',
    'kimi-k3.1-pro': 'moonshotai/kimi-k3.1-pro',
    // The book prices Kimi's moving alias under its own `~` id; there is no plain `moonshotai/kimi-latest`.
    'kimi-latest': '~moonshotai/kimi-latest',
};
/** Runtime metadata. `automaticRank`, not array position, owns automatic preference. */
export const LOCAL_RUNTIMES = [
    { id: 'synapse', automaticRank: 30, label: 'Synapse', onDevice: true, catalog: 'probe', tools: 'all', reach: 'http', ownedBy: 'bfi' },
    {
        id: 'ollama',
        automaticRank: 50,
        label: 'Ollama',
        onDevice: true,
        defaultBaseUrl: 'http://127.0.0.1:11434',
        catalog: 'probe',
        tools: 'probe',
        reach: 'http',
    },
    {
        id: 'freetoken',
        automaticRank: 60,
        label: 'FreeToken',
        onDevice: true,
        defaultBaseUrl: 'http://127.0.0.1:1919',
        catalog: 'probe',
        tools: 'unknown',
        reach: 'http',
    },
    {
        id: 'bfi',
        automaticRank: 20,
        label: 'Builderforce engine',
        onDevice: true,
        defaultBaseUrl: BFI_ENGINE_BASE_URL,
        catalog: 'declared',
        tools: 'all',
        reach: 'page',
        fallbackReach: 'host',
    },
    {
        id: 'webllm',
        automaticRank: 10,
        label: 'WebLLM',
        onDevice: true,
        defaultBaseUrl: WEBLLM_ENGINE_BASE_URL,
        catalog: 'declared',
        tools: 'unknown',
        reach: 'page',
    },
    {
        id: 'browser',
        automaticRank: 40,
        // PRD 42 · A1 — generic; the probe row carries the vendor's label ("Gemini Nano",
        // "Phi-4-mini"), so the picker shows "Gemini Nano (Chrome)" / "Phi-4-mini (Edge)".
        label: 'Built-in model',
        labelFromProbe: true,
        onDevice: true,
        defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
        catalog: 'declared',
        tools: 'unknown',
        reach: 'page',
    },
    { id: 'kimi-code', automaticRank: Number.POSITIVE_INFINITY, label: 'Kimi Code', onDevice: false, catalog: 'declared', tools: 'all', reach: 'http', gatewayVendor: 'kimi-code', catalogAliases: KIMI_CODE_CATALOG_ALIASES, providerSampling: true, accountProvider: 'kimi' },
];
/** The runtimes reached over HTTP — what a prober, a settings form or an endpoint
 *  builder iterates. */
export const HTTP_LOCAL_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.reach === 'http');
export const LOCAL_RUNTIME_IDS = LOCAL_RUNTIMES.map((r) => r.id);
export function isLocalRuntimeId(value) {
    return typeof value === 'string' && LOCAL_RUNTIME_IDS.includes(value);
}
/** The registry entry for an id. Total over {@link LocalRuntimeId}. */
export function localRuntime(id) {
    return LOCAL_RUNTIMES.find((r) => r.id === id);
}
/** The page runtimes a host process can serve itself when no page is open. */
export const HOST_FALLBACK_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.fallbackReach === 'host');
//# sourceMappingURL=runtimes.js.map