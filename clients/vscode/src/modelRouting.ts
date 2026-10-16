/**
 * WHERE a turn runs — the ONE place that answers it, for every AI surface in the editor.
 *
 * Two questions have to be answered together and were previously answered apart:
 *
 *   1. WHICH model serves this turn (an explicit pick, the project's Evermind, the
 *      configured default, or gateway auto) — `modelState.resolveEffectiveModelChoice`;
 *   2. WHICH transport that implies — the gateway, a runtime on this machine (a local
 *      pin), or LOCAL FIRST: with local inference enabled and nothing pinned, each call
 *      tries a capable on-device model and falls over to the gateway
 *      (`@builderforce/local-inference`).
 *
 * Answering (2) at each call site is what let them drift: the chat participant honoured a
 * picked model while the codebase scanner read `builderforce.defaultModel` straight from
 * configuration, so pinning a local model in the picker left the scanner talking to the
 * gateway under a different model entirely. A third copy of the rule had leaked into the
 * gateway client itself, which then had to know what a local model was.
 *
 * So the decision lives here, once, and every surface asks for a {@link ModelRoute}
 * rather than deriving one. `modelState` still owns the model POLICY (what the user
 * picked, what the project pins); this module owns the consequence.
 *
 * What deliberately does NOT route through here: the gateway's server-side services —
 * the limbic/personality block, builder insights, platform MCP tools, the model catalog.
 * Those are not completions a local runtime could serve; they are products of the
 * gateway. Telemetry, error reports and traces likewise keep going to the gateway
 * regardless of where inference ran.
 */

import type * as vscode from "vscode";
import {
  completeLocal,
  completeLocalFirst,
  createLocalFirstStream,
  createLocalStream,
  type BrainStreamFn,
} from "@seanhogg/builderforce-brain-embedded";
import {
  parseLocalModelRef,
  type LocalEndpoint,
  type LocalFirstAttemptRecord,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from "@builderforce/local-inference";
import {
  authorizeLocalEndpoint,
  complete,
  getApiKey,
  getBaseUrl,
  getLocalModelsConfig,
  type ChatMessage,
} from "./gateway";
import { probeLocalFirstRuntimes, type LocalModelsConfig } from "./localModels";
import { resolveEffectiveModelChoice } from "./modelState";
import { createNativeStream } from "./nativeBrainRun";

/** Where one turn will run, and with which model. */
export interface ModelRoute {
  /** The ref to send. Undefined means "let the gateway route". */
  model?: string;
  modelStrict?: boolean;
  routingMode: "auto" | "byo_pool";
  /**
   * Present when this turn is served by a runtime on THIS machine. Carrying the resolved
   * endpoint and bare model id (rather than re-parsing the ref downstream) is what keeps
   * the `local/<provider>/<model>` grammar knowledge in one module.
   */
  local?: { provider: LocalRuntimeId; model: string; endpoint: LocalEndpoint };
  /**
   * Present when an UNPINNED turn runs local-first: the on-device runtimes as probed for
   * this turn. Each call then tries a capable local model and falls over to the gateway
   * (see `createLocalFirstStream`). Mutually exclusive with `local` — a pin is a pin.
   */
  localFirst?: { probes: readonly LocalRuntimeProbe[] };
}

/**
 * Resolve the route for a turn. Safe to call signed out — every lookup underneath is
 * best-effort — which is what lets a caller ask BEFORE deciding whether sign-in is
 * required (see {@link routeRequiresSignIn}).
 */
export async function resolveModelRoute(secrets: vscode.SecretStorage): Promise<ModelRoute> {
  const choice = await resolveEffectiveModelChoice(secrets);
  const config = getLocalModelsConfig();
  const pin = parseLocalModelRef(choice.model);
  if (!pin) return withLocalFirst(choice, config);
  // A pin can outlive the thing it points at — a Kimi install signed out since the model
  // was chosen, an on-device runtime removed from settings. No endpoint means no local
  // route, so the turn falls back to the gateway rather than dispatching at `undefined`.
  const endpoint = config.endpoints[pin.provider];
  if (!endpoint) return choice;
  // Credential resolved HERE, once per turn, because it is the last async moment before
  // the transport is built — `routeStream` is synchronous by design and a fifteen-minute
  // Kimi token cannot be refreshed from inside it. A provider that cannot authorize falls
  // back to the gateway rather than dispatching a request that is certain to 401.
  const authorized = await authorizeLocalEndpoint(pin.provider, endpoint);
  if (!authorized.ok) return choice;
  return { ...choice, local: { ...pin, endpoint: authorized.endpoint } };
}

/**
 * LOCAL FIRST for an unpinned turn. Any model choice — an explicit pick, the project's
 * Evermind pin, a role pin, the configured default — names what the user wants and wins
 * outright, and so does an explicit "use my connected accounts" (`byo_pool`); only "let
 * the gateway route" is open to being served on this machine first. Probing is memoized
 * in `localModels`, so asking per turn costs nothing while nothing changed.
 */
async function withLocalFirst(choice: ModelRoute, config: LocalModelsConfig): Promise<ModelRoute> {
  if (choice.model || choice.routingMode !== "auto") return choice;
  const probes = await probeLocalFirstRuntimes(config);
  if (!probes.some((p) => p.models.length > 0)) return choice;
  return { ...choice, localFirst: { probes } };
}

/**
 * Whether this route needs a BuilderForce account. A local turn does not: it is served by
 * hardware the user already owns, so gating it on sign-in would be gating them out of
 * their own machine. A local-first turn does not either — signed out, it simply has no
 * cloud to fall back to.
 */
export function routeRequiresSignIn(route: ModelRoute): boolean {
  return route.local === undefined && route.localFirst === undefined;
}

/**
 * The extension-host log line for a local-first attempt that did NOT serve. The run's
 * own trace records the same fallback as `llm.local_fallback` (brain-embedded); this
 * line also covers the scanner, which has no run trace.
 */
function logLocalFirstAttempt(record: LocalFirstAttemptRecord): void {
  if (record.outcome === "served") return;
  const target = record.attempt.kind === "local" ? record.attempt.ref : "gateway";
  console.warn(`BuilderForce local-first: ${target} ${record.outcome}${record.detail ? ` (${record.detail})` : ""}`);
}

/**
 * The streaming completion fn for a route — the single branch between the two transports.
 * Both are the SAME shared streamer, so the agent loop, tool-call protocol and error
 * mapping are identical either way.
 *
 * `apiKey` may be undefined only when the route is local; a gateway route without a key
 * is a caller that skipped {@link routeRequiresSignIn}, and throwing here is better than
 * sending an unauthenticated turn that fails opaquely at the gateway.
 */
export function routeStream(route: ModelRoute, apiKey: string | undefined): BrainStreamFn {
  if (route.local) return createLocalStream(route.local.endpoint, route.local.model);
  if (route.localFirst) {
    return createLocalFirstStream({
      probes: route.localFirst.probes,
      cloud: apiKey ? createNativeStream(getBaseUrl(), apiKey) : null,
      onAttempt: logLocalFirstAttempt,
    });
  }
  if (!apiKey) throw new Error("not_signed_in");
  return createNativeStream(getBaseUrl(), apiKey);
}

/**
 * A non-streaming completion on a route — the twin of {@link routeStream} for the
 * surfaces that summarize rather than converse (the codebase scanner). Keeping both
 * branches here is what stops a non-chat surface quietly staying on the gateway when the
 * user has pinned a local model.
 */
export async function routeComplete(
  route: ModelRoute,
  secrets: vscode.SecretStorage,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (route.local) return completeLocal(route.local.endpoint, route.local.model, messages, signal);
  if (route.localFirst) {
    const signedIn = Boolean(await getApiKey(secrets));
    return completeLocalFirst({
      probes: route.localFirst.probes,
      messages,
      cloud: signedIn ? () => complete(secrets, messages, route.model, signal) : null,
      ...(signal ? { signal } : {}),
      onAttempt: logLocalFirstAttempt,
    });
  }
  return complete(secrets, messages, route.model, signal);
}
