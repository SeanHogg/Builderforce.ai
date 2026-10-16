/**
 * The runtime REGISTRY — every runtime a client on the user's machine can drive
 * directly, as data.
 *
 * Membership means "the CLIENT performs this call itself", not "the weights are on this
 * disk". Three entries are on-device engines (Synapse's native `bfi`, Ollama,
 * FreeToken): no account, no metering, available offline, and the only ones local-first
 * routing will try. `kimi-code` is Kimi's hosted API and belongs here anyway: its edge
 * refuses a hosted gateway before reading a credential, while the identical request
 * from the developer's own machine is the personal client the subscription is licensed
 * for. Same mechanism, different reason — hence `onDevice`.
 *
 * Kept as DATA so a host never branches on a runtime id: the picker, the probe, the
 * plan and the catalog binding all read the fields below.
 */

export type LocalRuntimeId = 'synapse' | 'ollama' | 'freetoken' | 'kimi-code';

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
  /** The `owned_by` this runtime stamps on its `/v1/models` rows, when distinctive.
   *  `bfi serve` starts at Ollama's port 11434 and walks upward when it is taken, so the
   *  Ollama URL can be answered by bfi; this is how a probe tells them apart. */
  ownedBy?: string;
}

/**
 * Registry order is preference order for local-first: Synapse first (our engine, and the
 * one that constrains tool calls for every model), then Ollama, then FreeToken.
 */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
  { id: 'synapse', label: 'Synapse', onDevice: true, catalog: 'probe', tools: 'all', ownedBy: 'bfi' },
  {
    id: 'ollama',
    label: 'Ollama',
    onDevice: true,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    catalog: 'probe',
    tools: 'probe',
  },
  {
    id: 'freetoken',
    label: 'FreeToken',
    onDevice: true,
    defaultBaseUrl: 'http://127.0.0.1:1919',
    catalog: 'probe',
    tools: 'unknown',
  },
  { id: 'kimi-code', label: 'Kimi Code', onDevice: false, catalog: 'declared', tools: 'all' },
];

export const LOCAL_RUNTIME_IDS: readonly LocalRuntimeId[] = LOCAL_RUNTIMES.map((r) => r.id);

export function isLocalRuntimeId(value: unknown): value is LocalRuntimeId {
  return typeof value === 'string' && (LOCAL_RUNTIME_IDS as readonly string[]).includes(value);
}

/** The registry entry for an id. Total over {@link LocalRuntimeId}. */
export function localRuntime(id: LocalRuntimeId): LocalRuntime {
  return LOCAL_RUNTIMES.find((r) => r.id === id)!;
}
