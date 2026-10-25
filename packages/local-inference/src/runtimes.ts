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

export type LocalRuntimeId = 'synapse' | 'ollama' | 'freetoken' | 'bfi' | 'webllm' | 'browser' | 'kimi-code';

/**
 * Where a runtime's calls go, and what (if anything) authenticates them. An on-device
 * engine normally leaves `token` unset; `bfi serve --api-key` and a signed-in Kimi
 * install carry one. Callers never branch on which — they pass the endpoint through.
 */
export interface LocalEndpoint {
  /** Runtime root (unnormalized is fine — every consumer normalizes). */
  baseUrl: string;
  /** Bearer credential, when this runtime needs one. */
  token?: string;
}

/** The endpoints a host resolved, per runtime. An absent runtime is simply not offered. */
export type LocalEndpoints = Readonly<Partial<Record<LocalRuntimeId, LocalEndpoint>>>;

/**
 * How the registry decides whether a runtime's model may take a TOOL turn.
 *
 *  - `all`: the runtime grammar-constrains tool calls for every model it serves
 *    (`bfi-server` parses `tools` into decode constraints regardless of the model);
 *  - `probe`: the runtime reports it per model (Ollama's `POST /api/show` →
 *    `capabilities: ["completion", "tools", …]`);
 *  - `unknown`: nothing says — treated as NOT tool-capable. A model that silently
 *    ignores `tools` answers an agent turn with prose about calling a tool, which is a
 *    worse failure than not trying it.
 */
export type LocalToolSupport = 'all' | 'probe' | 'unknown';

/**
 * How a runtime is REACHED.
 *
 *  - `http`: a server on this machine (or Kimi's API) answering the OpenAI routes. It has
 *    a URL a user may configure, and an HTTP prober asks it what it serves;
 *  - `page`: an engine INSIDE the page itself (our WebGPU `bfi`, WebLLM, Chrome's
 *    built-in model via the Prompt API). There is no server, no URL to configure and nothing to probe over HTTP — the
 *    host asks the page API directly and answers the chat route with an in-page shim
 *    (brain-embedded's `pageEnginesFetch`). Every HTTP prober, settings form and endpoint
 *    builder skips it by reading this field, never by comparing ids.
 *
 * A page runtime may also declare {@link LocalRuntime.fallbackReach} `host`: the SAME
 * engine run by the client host process itself, with no page (the editor's extension
 * host loads `bfi-web`'s wasm, CPU backend, in a worker thread).
 */
export type LocalRuntimeReach = 'http' | 'page';

export interface LocalRuntime {
  id: LocalRuntimeId;
  /**
   * Automatic local-first preference, lowest first. Explicit model pins never consult it.
   * The engines we ship and size ourselves come first — WebLLM and our `bfi` on WebGPU,
   * then Synapse's native `bfi` — then the browser's built-in model. A third-party server
   * the person runs (Ollama, FreeToken) is tried LAST: it is still a real local engine,
   * but only as good as the window it reports (`probe.ts` reads the one it SERVES) and
   * the tool-call dialect its model writes (`xmlToolCalls.ts` lifts the inline ones).
   */
  automaticRank: number;
  /** Brand token, deliberately NOT localized — "Ollama" is "Ollama" in every catalog. */
  label: string;
  /** Inference runs on the user's own CPU/GPU: residency `local`, zero cost, offline, and
   *  eligible for local-first routing. */
  onDevice: boolean;
  /** Where the runtime listens out of the box, or undefined when the host must DISCOVER
   *  it (Synapse publishes its port; Kimi's endpoint is in its install's config). */
  defaultBaseUrl?: string;
  /** `probe` = ask its OpenAI `/v1/models` route; `declared` = the host already holds the
   *  catalog (Kimi's install config), so probing would be a needless round trip. */
  catalog: 'probe' | 'declared';
  tools: LocalToolSupport;
  /** How it is reached — see {@link LocalRuntimeReach}. */
  reach: LocalRuntimeReach;
  /** How a host may still serve it when its primary reach is unavailable — `host`: a
   *  page runtime whose engine the host can run itself (`bfi`, whose wasm has a CPU
   *  backend), so a pinned model keeps running locally with the page closed. */
  fallbackReach?: 'host';
  /** The `owned_by` this runtime stamps on its `/v1/models` rows, when distinctive.
   *  `bfi serve` starts at Ollama's port 11434 and walks upward when it is taken, so the
   *  Ollama URL can be answered by bfi; this is how a probe tells them apart. */
  ownedBy?: string;
  /** The gateway vendor (`direct/<vendor>/<model>`) whose models this runtime serves when
   *  the CLIENT must make the call — Kimi Code, whose edge refuses the gateway. A gateway
   *  ref on that vendor is dispatched from the user's machine (`clientPinOf`). */
  gatewayVendor?: string;
  /** The provider chooses sampling per model, so a client sends no `temperature` —
   *  Kimi K3 accepts only `1` and 400s anything else. */
  providerSampling?: true;
}

/**
 * The non-routable roots the in-page engines' shim answers, one per page runtime.
 * `.local` never resolves to a real origin, so a request that somehow missed the shim
 * fails rather than leaving the page.
 */
export const BROWSER_ENGINE_BASE_URL = 'http://browser.local';
export const BFI_ENGINE_BASE_URL = 'http://bfi.local';
export const WEBLLM_ENGINE_BASE_URL = 'http://webllm.local';

/** Runtime metadata. `automaticRank`, not array position, owns automatic preference. */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
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
    label: 'Gemini Nano',
    onDevice: true,
    defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
    catalog: 'declared',
    tools: 'unknown',
    reach: 'page',
  },
  { id: 'kimi-code', automaticRank: Number.POSITIVE_INFINITY, label: 'Kimi Code', onDevice: false, catalog: 'declared', tools: 'all', reach: 'http', gatewayVendor: 'kimi-code', providerSampling: true },
];

/** The runtimes reached over HTTP — what a prober, a settings form or an endpoint
 *  builder iterates. */
export const HTTP_LOCAL_RUNTIMES: readonly LocalRuntime[] = LOCAL_RUNTIMES.filter((r) => r.reach === 'http');

export const LOCAL_RUNTIME_IDS: readonly LocalRuntimeId[] = LOCAL_RUNTIMES.map((r) => r.id);

export function isLocalRuntimeId(value: unknown): value is LocalRuntimeId {
  return typeof value === 'string' && (LOCAL_RUNTIME_IDS as readonly string[]).includes(value);
}

/** The registry entry for an id. Total over {@link LocalRuntimeId}. */
export function localRuntime(id: LocalRuntimeId): LocalRuntime {
  return LOCAL_RUNTIMES.find((r) => r.id === id)!;
}

/** The page runtimes a host process can serve itself when no page is open. */
export const HOST_FALLBACK_RUNTIMES: readonly LocalRuntime[] = LOCAL_RUNTIMES.filter((r) => r.fallbackReach === 'host');
