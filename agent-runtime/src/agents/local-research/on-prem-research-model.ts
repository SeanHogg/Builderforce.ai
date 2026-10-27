/**
 * The on-prem runtime's local model for `local_research` — the twin of the editor's
 * `clients/vscode/src/localResearch/editorResearchPort.ts`.
 *
 * Not a second local client: a completion goes through the runtime's ONE provider
 * cascade (`provider-cascade.ts`, the path the local brain's cortex calls), narrowed to
 * the configured providers that execute on THIS machine: a cascade wire (Ollama native,
 * OpenAI-compatible) whose `baseUrl` is loopback (127.0.0.1, ::1, localhost). A provider
 * id or api that merely SOUNDS local is not enough — an `ollama` provider pointed at a LAN
 * box or a hosted endpoint would ship quoted code off the machine. No such provider is
 * ever in the narrowed cascade, so a research answer is free on-machine tokens or nothing.
 *
 * `available()` asks each such provider's catalog route (Ollama `/api/tags`, OpenAI-
 * compatible `/models`) with a short timeout, memoized per URL, so the catalog decides per run
 * whether to advertise the tool without a localhost round trip per turn.
 */

import type { LocalResearchCapability } from "@builderforce/agent-tools";
import { nodeResearchCapability, type LocalResearchModel } from "@builderforce/agent-tools/node-research.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { normalizeBaseUrl } from "../../utils/normalize-base-url.js";
import { isLoopbackUrl } from "../../gateway/net.js";
import { resolveOllamaApiBase } from "../models-config.providers.js";
import { CASCADE_APIS, cascadeTargets, runProviderCascade, type CascadeTarget } from "../provider-cascade.js";
import { logDebug } from "../../logger.js";

/** Room for a cited, brief answer; the tool asks for brevity. */
const RESEARCH_MAX_TOKENS = 1_024;
const RESEARCH_TEMPERATURE = 0.1;
const PROBE_TIMEOUT_MS = 1_500;
const PROBE_TTL_MS = 30_000;

export interface OnPremResearchModel extends LocalResearchModel {
  /** Whether a local provider answers its catalog route right now (memoized). */
  available(): Promise<boolean>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OnPremResearchModelDeps {
  fetch?: FetchLike;
  now?: () => number;
}

/** A configured provider that serves on this machine (loopback `baseUrl`) over a wire the
 *  cascade calls. The id is not consulted: residency is where the requests GO. */
export function isLocalResearchProvider(_id: string, cfg: { api?: string; baseUrl?: string }): boolean {
  return cfg.api != null && CASCADE_APIS.has(cfg.api) && isLoopbackUrl(cfg.baseUrl);
}

/** The local providers the research model would ask, in cascade order. */
function localResearchTargets(config: BuilderForceAgentsConfig | undefined): CascadeTarget[] {
  return cascadeTargets(config, isLocalResearchProvider);
}

function catalogUrl(target: CascadeTarget): string {
  return target.cfg.api === "ollama"
    ? `${resolveOllamaApiBase(target.cfg.baseUrl)}/api/tags`
    : `${normalizeBaseUrl(target.cfg.baseUrl)}/models`;
}

/** Per catalog URL, process-wide: a research model is built per run, the answer only
 *  changes when the user starts or stops a runtime. */
const probes = new Map<string, { at: number; value: Promise<boolean> }>();

/** Forget every memoized probe (tests). */
export function resetLocalResearchProbesForTests(): void {
  probes.clear();
}

function reachable(fetchImpl: FetchLike, url: string, now: number): Promise<boolean> {
  const hit = probes.get(url);
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.value;
  const value = probeOnce(fetchImpl, url);
  probes.set(url, { at: now, value });
  return value;
}

async function probeOnce(fetchImpl: FetchLike, url: string): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The research model over `config`'s local providers. Null when none is configured —
 * the surface then never advertises `local_research`.
 */
export function onPremResearchModel(
  config: BuilderForceAgentsConfig | undefined,
  deps: OnPremResearchModelDeps = {},
): OnPremResearchModel | null {
  const targets = localResearchTargets(config);
  if (targets.length === 0) return null;
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  return {
    async complete(messages, signal) {
      const answer = await runProviderCascade({
        config,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        maxTokens: RESEARCH_MAX_TOKENS,
        temperature: RESEARCH_TEMPERATURE,
        signal,
        only: isLocalResearchProvider,
      });
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("local_research aborted");
      if (!answer) throw new Error("No local model on this machine answered.");
      return answer;
    },
    async available() {
      const at = now();
      const answers = await Promise.all(targets.map((t) => reachable(fetchImpl, catalogUrl(t), at)));
      return answers.some(Boolean);
    },
  };
}

/**
 * The run's `local.research` backing: the local research model over the shared Node half
 * (`@builderforce/agent-tools/node-research` — file fingerprints and the persisted answer
 * cache under `<workspace>/.builderforce/`). Undefined unless a local provider is
 * configured AND answers now, so `local_research` is advertised only when it can run.
 */
export async function resolveOnPremResearch(
  workspaceRoot: string,
  config: BuilderForceAgentsConfig | undefined,
  deps?: OnPremResearchModelDeps,
): Promise<LocalResearchCapability | undefined> {
  const model = onPremResearchModel(config, deps);
  if (!model || !(await model.available().catch((err: unknown) => { logDebug(`local_research: local model probe failed: ${String(err)}`); return false; }))) return undefined;
  return nodeResearchCapability(workspaceRoot, model);
}
