/**
 * On-device model support for the editor surface — a chat turn served by a runtime on
 * the DEVELOPER'S OWN MACHINE (Synapse, Ollama, FreeToken — or Kimi Code, called from
 * this machine) instead of the BuilderForce gateway.
 *
 * The runtime registry, the `local/<runtime>/<model>` ref grammar, the probe, the
 * local-first plan and its failover rule are host-neutral and live in
 * `@builderforce/local-inference`; the shared streamer bound to them (pinned and
 * local-first transports, the non-streaming twin) is brain-embedded's
 * `localFirstTransport`, shared with the Chrome extension. What stays HERE is the
 * editor's binding: which endpoints this machine has (handed in from `gateway.ts`), the
 * memoized capability probe a per-turn route reads, the Kimi rows read off disk, the
 * proxy fence, and the picker rows.
 *
 * This is the DIRECT path, and it is deliberately distinct from the cloud's
 * `direct/ollama-local/default` vendor (`api/.../vendors/ollamaLocal.ts`). That one
 * exists so a CLOUD turn can reach a tenant's private runtime, which the Worker cannot
 * address itself — so it relays through the connected agent host's egress fence. The
 * extension host is a Node process on the same machine as the runtime, so it opens the
 * socket itself. Complementary, not duplicates.
 *
 * Kept free of any `vscode` import so it is unit testable in the harness. The settings
 * READ lives with the other configuration accessors in `gateway.ts`; this module is
 * handed the resolved values.
 */

import {
  createLocalRuntimeProber,
  formatLocalModelRef,
  localRuntime,
  matchLocalChatEndpoint,
  probeLocalRuntimes,
  type FetchLike,
  type LocalEndpoint,
  type LocalEndpoints,
  type LocalModel,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from "@builderforce/local-inference";
import { hostPageEngines } from "./pageEngineBridge";

// Re-exported for the editor modules that already reach the local path through this
// file (the panel's proxy fence, the Synapse catalog, the model-state pin check, the
// model picker). One import site per concern; the definitions are the package's.
export { isLocalModelRef, normalizeLocalBaseUrl } from "@builderforce/local-inference";
export type { LocalEndpoint, LocalModel } from "@builderforce/local-inference";

/** Resolved `builderforce.localModels.*` settings plus discovered installs, built by
 *  `gateway.ts`. Runtimes absent from `endpoints` are simply not offered. */
export interface LocalModelsConfig {
  enabled: boolean;
  /** Serve an UNPINNED turn from a capable on-device model first and fail over to the
   *  gateway. Only meaningful while `enabled`; absent = off. */
  localFirst?: boolean;
  /** Endpoint per runtime. `kimi-code` appears only when a signed-in install was found;
   *  `synapse` only when one was configured or discovered. An unreachable engine simply
   *  contributes no models — the normal case for a developer running none. */
  endpoints: LocalEndpoints;
  /** Models the Kimi Code install declares. There is no `/v1/models` to probe — Kimi's
   *  catalog is in its own config, already read. */
  kimiCodeModels?: readonly { model: string; displayName: string }[];
}

/** The global fetch, read at CALL time so a harness that swaps it is honoured. */
const globalFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * The endpoint `url` belongs to, or null when this machine serves no such endpoint — the
 * destination fence for the webview's host-performed fetch (`llm.fetch` in
 * `builderforcePanel.ts`), which also names the credential that destination takes. The
 * credential never reaches the webview: the HOST attaches the Authorization header.
 */
export function resolveLocalChatEndpoint(
  config: LocalModelsConfig,
  url: string,
): { provider: LocalRuntimeId; endpoint: LocalEndpoint } | null {
  return matchLocalChatEndpoint(config.endpoints, url);
}

/**
 * Every model this machine can serve directly, for the pickers. Probed FRESH (the user
 * opening a picker may have just started a runtime) and without capability cards — a
 * row needs only the id. Kimi's rows come from the install already read.
 */
export async function listLocalModels(config: LocalModelsConfig, fetchImpl: FetchLike = globalFetch): Promise<LocalModel[]> {
  if (!config.enabled) return [];
  const probes = await probeLocalRuntimes(fetchImpl, config.endpoints);
  const kimi: LocalModel[] = config.endpoints["kimi-code"]
    ? (config.kimiCodeModels ?? []).map((entry) => ({
        ref: formatLocalModelRef("kimi-code", entry.model),
        provider: "kimi-code" as const,
        model: entry.model,
        label: entry.displayName,
      }))
    : [];
  return [...probes.flatMap((p) => p.models), ...kimi];
}

/**
 * The probe a local-first ROUTE reads — memoized, because it runs on every turn and the
 * answer changes only when a runtime starts, stops or pulls a model, and with capability
 * cards, because the plan needs to know which models may take a tool turn.
 */
const localFirstProber = createLocalRuntimeProber(globalFetch, { capabilities: true });

/**
 * The runtimes a local-first route may try, or none while the feature or the mode is off:
 * the HTTP runtimes on this machine, then the page engines the chat webview runs on
 * WebGPU (asked over the bridge — none while no panel is open, never a failure).
 */
export async function probeLocalFirstRuntimes(
  config: LocalModelsConfig,
  pageProbe: () => Promise<LocalRuntimeProbe[]> = () => hostPageEngines.probe(),
): Promise<LocalRuntimeProbe[]> {
  if (!config.enabled || !config.localFirst) return [];
  const [http, page] = await Promise.all([
    localFirstProber.probe(config.endpoints),
    pageProbe().catch((): LocalRuntimeProbe[] => []),
  ]);
  return [...http, ...page];
}

/**
 * On-device models in the shape the SHARED model-list builder takes — the one conversion
 * between "what the runtimes reported" and "a row in the list", for both the composer's
 * `/` menu and the `Pick Model` QuickPick.
 */
export function localModelOptions(
  models: readonly LocalModel[],
): Array<{ id: string; label: string; runtime: string }> {
  return models.map((entry) => ({
    id: entry.ref,
    label: entry.label ?? entry.model,
    runtime: localRuntime(entry.provider).label,
  }));
}
