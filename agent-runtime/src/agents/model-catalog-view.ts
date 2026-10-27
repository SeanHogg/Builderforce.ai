/**
 * The ON-PREM binding of the shared `CatalogView` port (`@builderforce/model-catalog`)
 * — how the pure router (`@builderforce/model-router`) reads THIS host's catalog.
 * The twin of the Worker's `api/src/application/llm/catalogView.ts`.
 *
 *   • vendor     — the provider a candidate was configured under (`normalizeProviderId`),
 *                  the unit auth-profile cooldowns already work in.
 *   • price      — the `cost` block every on-prem model definition carries. On-prem
 *                  costs are USD per MILLION tokens; the port speaks USD per TOKEN, so
 *                  this binding converts with the shared `perMillionToPerToken` (the
 *                  same conversion `utils/usage-format.ts` prices usage with).
 *   • tier       — the shared rule (`resolveModelTier`) with only a price: this host
 *                  has no curated tier column, so the price band decides.
 *   • free       — an all-zero cost is how a provider module writes "we don't publish a
 *                  price" as often as "this is free", so on a CLOUD model it counts as
 *                  free only when the catalog SAYS free ({@link isExplicitlyFree}); any
 *                  other zero is an UNKNOWN price — never evidence of cheapness.
 *   • residency  — `local` for a model served by the user's own machine: a local
 *                  inference api (ollama / llama.cpp / transformers), a loopback
 *                  `baseUrl` (`isLoopbackUrl`, vLLM / LM Studio / FreeToken / Synapse on
 *                  127.0.0.1), or a provider that only ever runs locally — the shared
 *                  on-device registry (`@builderforce/local-inference`), the BYO table's
 *                  `local_runtime` providers, and the engines only this host drives.
 *                  A `local/<runtime>/<model>` ref is answered by the shared
 *                  `localCatalogView`, layered in front.
 *
 * A model the catalog does not list answers `undefined` for tier and price — the
 * router treats that as "unknown", never as cheap.
 */

import { LOCAL_RUNTIMES, localCatalogView } from "@builderforce/local-inference";
import {
  LLM_PROVIDER_INFO,
  perMillionToPerToken,
  resolveModelTier,
  type CatalogView,
  type ModelPrice,
  type ModelResidency,
} from "@builderforce/model-catalog";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import type { ModelApi } from "../config/types.models.js";
import { isLoopbackUrl } from "../gateway/net.js";
import { logDebug } from "../logger.js";
import { resolveBuilderForceAgentsAgentDir } from "./agent-paths.js";
import { discoverAuthStorage, discoverModels } from "./model-discovery.js";
import { modelKey, normalizeProviderId } from "./model-selection.js";

/** The cost block of an on-prem model definition — USD per MILLION tokens. */
export interface PerMillionCost {
  input: number;
  output: number;
}

/** One catalog row as this adapter reads it. */
export interface OnPremCatalogEntry {
  provider: string;
  id: string;
  cost?: PerMillionCost;
  api?: ModelApi | string;
  baseUrl?: string;
}

/** Inference apis that only ever execute on the user's own machine. */
const LOCAL_APIS: ReadonlySet<string> = new Set(["ollama", "llama", "transformers"]);

/** Engines only THIS host drives — the shared registry lists the runtimes a client calls
 *  itself, and none of these is one. */
const ON_PREM_ONLY_LOCAL_PROVIDERS = ["lmstudio", "vllm", "llama", "builderforcellm-local"] as const;

/** Providers that only ever execute on the user's own machine, for a candidate the
 *  catalog has no row for (an operator pin on a provider whose discovery found nothing).
 *  Derived from the shared declarations, plus this host's own engines. */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set([
  ...LOCAL_RUNTIMES.filter((r) => r.onDevice && r.reach === "http").map((r) => r.id),
  ...LLM_PROVIDER_INFO.filter((p) => p.credential === "local_runtime").map((p) => p.id),
  ...ON_PREM_ONLY_LOCAL_PROVIDERS,
]);

const finiteNonNegative = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;

/** Per-million on-prem cost → per-token port price. `undefined` for a malformed block. Pure. */
export function priceForCost(cost: PerMillionCost | undefined): ModelPrice | undefined {
  const input = finiteNonNegative(cost?.input);
  const output = finiteNonNegative(cost?.output);
  if (input === undefined || output === undefined) {
    return undefined;
  }
  return { input: perMillionToPerToken(input), output: perMillionToPerToken(output) };
}

/** Providers whose whole catalog is a free pool — the first-party Builderforce free-model
 *  proxy (`buildBuilderForceAgentsllmProvider`, whose cost block is named FREE). */
const FREE_POOL_PROVIDERS: ReadonlySet<string> = new Set(["builderforcellm"]);

/** Upstream catalogs mark a free variant in the id itself (`…:free` on OpenRouter-style
 *  catalogs, `…-free` on OpenCode Zen). */
const FREE_ID_MARKER = /[:-]free$/i;

/** Does the catalog SAY this model is free (rather than merely carry a zero cost)? Pure. */
export function isExplicitlyFree(provider: string, id: string): boolean {
  return FREE_POOL_PROVIDERS.has(normalizeProviderId(provider)) || FREE_ID_MARKER.test(id.trim());
}

const isZeroCost = (cost: PerMillionCost | undefined): boolean =>
  cost !== undefined && cost.input === 0 && cost.output === 0;

/** Does this provider/row execute on the user's own machine? Pure. */
export function isLocalModel(provider: string, entry?: Pick<OnPremCatalogEntry, "api" | "baseUrl">): boolean {
  if (LOCAL_PROVIDERS.has(normalizeProviderId(provider))) {
    return true;
  }
  return (entry?.api != null && LOCAL_APIS.has(entry.api)) || isLoopbackUrl(entry?.baseUrl);
}

/** The vendor a `provider/model` candidate key routes through. Pure. */
export function vendorOfCandidateKey(key: string): string {
  const slash = key.indexOf("/");
  return normalizeProviderId(slash === -1 ? key : key.slice(0, slash));
}

/**
 * Bind a set of catalog rows to the port. Rows are keyed `provider/id` (the candidate
 * key space `resolveFallbackCandidates` and learned routing already use); the FIRST
 * row for a key wins, so a caller lists its most authoritative source first. Pure.
 */
export function catalogViewFromEntries(entries: readonly OnPremCatalogEntry[]): CatalogView {
  const byKey = new Map<string, OnPremCatalogEntry>();
  for (const entry of entries) {
    const provider = normalizeProviderId(entry.provider ?? "");
    const id = entry.id?.trim();
    if (!provider || !id) {
      continue;
    }
    const key = modelKey(provider, id);
    if (!byKey.has(key)) {
      byKey.set(key, { ...entry, provider, id });
    }
  }
  const rowOf = (model: string): OnPremCatalogEntry | undefined => {
    const slash = model.indexOf("/");
    if (slash === -1) {
      return undefined;
    }
    return byKey.get(modelKey(normalizeProviderId(model.slice(0, slash)), model.slice(slash + 1)));
  };
  const residency = (model: string): ModelResidency =>
    isLocalModel(vendorOfCandidateKey(model), rowOf(model)) ? "local" : "cloud";
  /** The cost the router may trust: a local model's is zero whatever its row says; a
   *  cloud model's zero counts only when the catalog says free; else as written. */
  const trustedCost = (model: string): PerMillionCost | undefined => {
    if (residency(model) === "local") {
      return { input: 0, output: 0 };
    }
    const row = rowOf(model);
    if (!row || (isZeroCost(row.cost) && !isExplicitlyFree(row.provider, row.id))) {
      return undefined;
    }
    return row.cost;
  };
  const entriesView: CatalogView = {
    vendorOf: vendorOfCandidateKey,
    tierOf: (model) => resolveModelTier({ price: priceForCost(trustedCost(model)) }),
    priceOf: (model) => priceForCost(trustedCost(model)),
    residencyOf: residency,
  };
  return localCatalogView(entriesView);
}

/** The rows explicitly configured under `models.providers` — the operator's own word. */
function configuredEntries(cfg: BuilderForceAgentsConfig | undefined): OnPremCatalogEntry[] {
  const providers = cfg?.models?.providers ?? {};
  return Object.entries(providers).flatMap(([provider, pc]) =>
    (pc?.models ?? []).map((m) => ({
      provider,
      id: m.id,
      cost: m.cost,
      api: m.api ?? pc.api,
      baseUrl: pc.baseUrl,
    })),
  );
}

/** The rows `models.json` holds (implicit providers merged with configured ones). */
function registryEntries(agentDir: string): OnPremCatalogEntry[] {
  const registry = discoverModels(discoverAuthStorage(agentDir), agentDir);
  return registry.getAll().map((m) => ({
    provider: m.provider,
    id: m.id,
    cost: m.cost,
    api: m.api,
    baseUrl: m.baseUrl,
  }));
}

/**
 * This host's catalog view: configured providers first, then `models.json`. Never
 * throws — an unreadable `models.json` leaves the configured rows, and no rows at all
 * leave a view that knows no tier, which the router reads as "keep the given order".
 */
export function loadOnPremCatalogView(params?: {
  cfg?: BuilderForceAgentsConfig;
  agentDir?: string;
}): CatalogView {
  const entries = configuredEntries(params?.cfg);
  try {
    entries.push(...registryEntries(params?.agentDir ?? resolveBuilderForceAgentsAgentDir()));
  } catch (err) {
    // models.json is optional — the configured rows still answer.
    logDebug(`[model-catalog-view] models.json unreadable, configured rows only: ${String(err)}`);
  }
  return catalogViewFromEntries(entries);
}
