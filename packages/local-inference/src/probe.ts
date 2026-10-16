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
import {
  LOCAL_RUNTIMES,
  localRuntime,
  type LocalEndpoint,
  type LocalEndpoints,
  type LocalRuntimeId,
} from './runtimes.js';

/** The `fetch` shape the package needs — satisfied by the global in every host. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One model a runtime serves. */
export interface LocalModel {
  /** The full `local/<runtime>/<model>` ref. */
  ref: string;
  /** The runtime serving it (named `provider` because every stored ref and picker row
   *  already says so). */
  provider: LocalRuntimeId;
  /** The bare id the runtime itself knows, e.g. `qwen3:8b`. */
  model: string;
  /** The runtime's own human label, when it publishes one (Kimi declares "K2.7 Coding");
   *  a picker falls back to the id. */
  label?: string;
  /** May take a TOOL turn. Absent/false = no — see `LocalToolSupport`: unknown is never
   *  read as capable. */
  tools?: boolean;
  /** Context window in tokens, when the runtime reports one. Absent = unknown. */
  contextTokens?: number;
}

/** One runtime's answer. */
export interface LocalRuntimeProbe {
  provider: LocalRuntimeId;
  endpoint: LocalEndpoint;
  /** Its catalog route answered OK. False = not running / wrong port / refused. */
  reachable: boolean;
  models: LocalModel[];
}

export interface LocalProbeOptions {
  /** Per-request timeout. Default {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Also learn per-model capabilities (one extra localhost call per model on a runtime
   * whose tool support is `probe`). A picker listing rows does not need it; a router
   * deciding whether a model may take a tool turn does.
   */
  capabilities?: boolean;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/** GET/POST JSON with a timeout. Never throws: `undefined` = no usable answer. */
async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: abort.signal });
    if (!res.ok) return undefined;
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** `/v1/models` rows: string ids only (a numeric id is dropped, never pinned as "42"). */
function catalogRows(json: unknown): Array<{ id: string; ownedBy?: string }> {
  const data = (json as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const { id, owned_by } = (entry ?? {}) as { id?: unknown; owned_by?: unknown };
    if (typeof id !== 'string' || id.length === 0) return [];
    return [{ id, ...(typeof owned_by === 'string' ? { ownedBy: owned_by } : {}) }];
  });
}

/**
 * Ollama's per-model card (`POST /api/show`): `capabilities` (`completion`, `tools`,
 * `embedding`, …) and `model_info["<arch>.context_length"]`. `undefined` = the runtime
 * gave no card (an older Ollama, or an Ollama-compatible server that lacks the route).
 */
async function ollamaCard(
  fetchImpl: FetchLike,
  endpoint: LocalEndpoint,
  model: string,
  timeoutMs: number,
): Promise<{ capabilities?: string[]; contextTokens?: number } | undefined> {
  const json = await fetchJson(
    fetchImpl,
    `${normalizeLocalBaseUrl(endpoint.baseUrl)}/api/show`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...localAuthHeaders(endpoint) },
      body: JSON.stringify({ model, name: model }),
    },
    timeoutMs,
  );
  if (!json || typeof json !== 'object') return undefined;
  const { capabilities, model_info } = json as { capabilities?: unknown; model_info?: unknown };
  const caps = Array.isArray(capabilities) ? capabilities.filter((c): c is string => typeof c === 'string') : undefined;
  let contextTokens: number | undefined;
  if (model_info && typeof model_info === 'object') {
    for (const [key, value] of Object.entries(model_info as Record<string, unknown>)) {
      if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) contextTokens = value;
    }
  }
  return { ...(caps ? { capabilities: caps } : {}), ...(contextTokens ? { contextTokens } : {}) };
}

async function probeRuntime(
  fetchImpl: FetchLike,
  provider: LocalRuntimeId,
  endpoint: LocalEndpoint,
  options: Required<LocalProbeOptions>,
): Promise<{ probe: LocalRuntimeProbe; ownedBy: Map<string, string | undefined> }> {
  const runtime = localRuntime(provider);
  const ownedBy = new Map<string, string | undefined>();
  const json = await fetchJson(
    fetchImpl,
    localModelsUrl(endpoint.baseUrl),
    { headers: { accept: 'application/json', ...localAuthHeaders(endpoint) } },
    options.timeoutMs,
  );
  if (json === undefined) return { probe: { provider, endpoint, reachable: false, models: [] }, ownedBy };
  const rows = catalogRows(json);
  const models = await Promise.all(
    rows.map(async ({ id, ownedBy: owner }): Promise<LocalModel | null> => {
      ownedBy.set(id, owner);
      const base: LocalModel = { ref: formatLocalModelRef(provider, id), provider, model: id };
      if (runtime.tools === 'all') return { ...base, tools: true };
      if (runtime.tools === 'unknown' || !options.capabilities) return base;
      const card = await ollamaCard(fetchImpl, endpoint, id, options.timeoutMs);
      if (!card) return base;
      // An embedding-only model cannot hold a conversation at all; offering it for a chat
      // turn is a guaranteed failure.
      if (card.capabilities && !card.capabilities.includes('completion') && card.capabilities.includes('embedding')) {
        return null;
      }
      return {
        ...base,
        ...(card.capabilities?.includes('tools') ? { tools: true } : {}),
        ...(card.contextTokens ? { contextTokens: card.contextTokens } : {}),
      };
    }),
  );
  return {
    probe: { provider, endpoint, reachable: true, models: models.filter((m): m is LocalModel => m !== null) },
    ownedBy,
  };
}

/**
 * Probe every PROBED runtime that has an endpoint, concurrently (localhost round trips
 * must not queue behind one another). A runtime with a blank or absent endpoint is not
 * contacted at all; a `declared` runtime (Kimi) is the host's to list. Never throws.
 *
 * One de-duplication: a model whose `owned_by` names ANOTHER configured runtime is that
 * runtime's, not this one's — `bfi serve` on the Ollama port must not list each Synapse
 * model twice (once as `local/ollama/…`, once as `local/synapse/…`). When the owner is
 * not configured the row stays where it was found, so it remains servable.
 */
export async function probeLocalRuntimes(
  fetchImpl: FetchLike,
  endpoints: LocalEndpoints,
  options: LocalProbeOptions = {},
): Promise<LocalRuntimeProbe[]> {
  const resolved: Required<LocalProbeOptions> = {
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    capabilities: options.capabilities ?? false,
  };
  const targets = LOCAL_RUNTIMES.filter(
    (r) => r.catalog === 'probe' && (endpoints[r.id]?.baseUrl.trim().length ?? 0) > 0,
  );
  const results = await Promise.all(targets.map((r) => probeRuntime(fetchImpl, r.id, endpoints[r.id]!, resolved)));
  const probed = new Set(targets.map((r) => r.id));
  return results.map(({ probe, ownedBy }) => ({
    ...probe,
    models: probe.models.filter((m) => {
      const owner = LOCAL_RUNTIMES.find((r) => r.ownedBy !== undefined && r.ownedBy === ownedBy.get(m.model));
      return !owner || owner.id === probe.provider || !probed.has(owner.id);
    }),
  }));
}

/** Every model across a probe, in registry order. */
export function probedModels(probes: readonly LocalRuntimeProbe[]): LocalModel[] {
  return probes.flatMap((p) => p.models);
}

/**
 * A memoizing prober — the shape a per-turn router wants. Probing on every turn would
 * add a localhost round trip (plus a capability card per model) to each one, and the
 * answer changes only when the user starts, stops or pulls something. Concurrent callers
 * share one in-flight probe; `fresh` forces a re-probe (a picker being opened).
 */
export interface LocalRuntimeProber {
  probe(endpoints: LocalEndpoints, options?: { fresh?: boolean }): Promise<LocalRuntimeProbe[]>;
  invalidate(): void;
}

export function createLocalRuntimeProber(
  fetchImpl: FetchLike,
  config: LocalProbeOptions & { ttlMs?: number; now?: () => number } = {},
): LocalRuntimeProber {
  const ttlMs = config.ttlMs ?? 15_000;
  const now = config.now ?? (() => Date.now());
  let memo: { key: string; at: number; value: Promise<LocalRuntimeProbe[]> } | undefined;
  return {
    probe(endpoints, options = {}) {
      // Keyed on the endpoints (tokens included — this memo is in-process only), so a
      // settings change is a miss rather than a stale answer for the old URL.
      const key = JSON.stringify(LOCAL_RUNTIMES.map((r) => endpoints[r.id] ?? null));
      const at = now();
      if (!options.fresh && memo && memo.key === key && at - memo.at < ttlMs) return memo.value;
      const value = probeLocalRuntimes(fetchImpl, endpoints, config);
      memo = { key, at, value };
      return value;
    },
    invalidate() {
      memo = undefined;
    },
  };
}
