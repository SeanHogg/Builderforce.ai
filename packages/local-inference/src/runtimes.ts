/**
 * The runtime REGISTRY — every runtime a client on the user's machine can drive
 * directly, as data.
 *
 * Membership means "the CLIENT performs this call itself", not "the weights are on this
 * disk". Four entries are on-device engines (Synapse's native `bfi`, Ollama, FreeToken,
 * and the browser's own built-in model): no account, no metering, available offline, and
 * the only ones local-first routing will try. `kimi-code` is Kimi's hosted API and belongs here anyway: its edge
 * refuses a hosted gateway before reading a credential, while the identical request
 * from the developer's own machine is the personal client the subscription is licensed
 * for. Same mechanism, different reason — hence `onDevice`.
 *
 * Kept as DATA so a host never branches on a runtime id: the picker, the probe, the
 * plan and the catalog binding all read the fields below.
 */

export type LocalRuntimeId = 'synapse' | 'ollama' | 'freetoken' | 'browser' | 'kimi-code';

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
 *  - `page`: an engine INSIDE the page itself (Chrome's built-in model via the Prompt
 *    API). There is no server, no URL to configure and nothing to probe over HTTP — the
 *    host asks the page API directly and answers the chat route with an in-page shim
 *    (brain-embedded's `browserEngine`). Every HTTP prober, settings form and endpoint
 *    builder skips it by reading this field, never by comparing ids.
 */
export type LocalRuntimeReach = 'http' | 'page';

export interface LocalRuntime {
  id: LocalRuntimeId;
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
  /** The `owned_by` this runtime stamps on its `/v1/models` rows, when distinctive.
   *  `bfi serve` starts at Ollama's port 11434 and walks upward when it is taken, so the
   *  Ollama URL can be answered by bfi; this is how a probe tells them apart. */
  ownedBy?: string;
}

/**
 * The non-routable root the in-page engine's shim answers. `.local` never resolves to a
 * real origin, so a request that somehow missed the shim fails rather than leaving the
 * page.
 */
export const BROWSER_ENGINE_BASE_URL = 'http://browser.local';

/**
 * Registry order is preference order for local-first: Synapse first (our engine, and the
 * one that constrains tool calls for every model), then Ollama, then FreeToken, then the
 * browser's built-in model — the smallest of them, tried only when nothing the user
 * installed is up.
 */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
  { id: 'synapse', label: 'Synapse', onDevice: true, catalog: 'probe', tools: 'all', reach: 'http', ownedBy: 'bfi' },
  {
    id: 'ollama',
    label: 'Ollama',
    onDevice: true,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    catalog: 'probe',
    tools: 'probe',
    reach: 'http',
  },
  {
    id: 'freetoken',
    label: 'FreeToken',
    onDevice: true,
    defaultBaseUrl: 'http://127.0.0.1:1919',
    catalog: 'probe',
    tools: 'unknown',
    reach: 'http',
  },
  // Chrome's built-in model (Prompt API). Its single model is declared by the page probe,
  // and it cannot take a tool turn: the Prompt API has no tool-call protocol.
  {
    id: 'browser',
    label: 'Gemini Nano',
    onDevice: true,
    defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
    catalog: 'declared',
    tools: 'unknown',
    reach: 'page',
  },
  { id: 'kimi-code', label: 'Kimi Code', onDevice: false, catalog: 'declared', tools: 'all', reach: 'http' },
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
