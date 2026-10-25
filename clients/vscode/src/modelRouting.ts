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
 * the personality block, builder insights, platform MCP tools, the model catalog.
 * Those are not completions a local runtime could serve; they are products of the
 * gateway. Telemetry, error reports and traces likewise keep going to the gateway
 * regardless of where inference ran.
 */

import type * as vscode from "vscode";
import {
  completeLocal,
  completeLocalFirst,
  createHostModelStream,
  localFirstApplies,
  NO_LOCAL_MODEL,
  NO_SPECIFIC_MODEL,
  NOT_SIGNED_IN,
  pageRuntimePin,
  type BrainStreamFn,
  type ModelFallbackEvent,
} from "@seanhogg/builderforce-brain-embedded";
import {
  clientPinOf,
  localRuntime,
  formatLocalModelRef,
  type LocalEndpoint,
  type LocalFirstAccount,
  type LocalFirstAttemptRecord,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from "@builderforce/local-inference";
import {
  complete,
  getApiKey,
  getBaseUrl,
  getLocalModelsConfig,
  type ChatMessage,
} from "./gateway";
import { authorizeLocalEndpoint } from "./localEndpointAuth";
import { editorAccounts } from "./providerConnect";
import { logLine } from "./errorReporter";
import { probeLocalFirstRuntimes, type LocalModelsConfig } from "./localModels";
import { resolveEffectiveModelChoice } from "./modelState";
import { createNativeStream } from "./nativeBrainRun";
import { hostModelProvisioner } from "./hostBfi/provision";
import { hostPageEngines } from "./pageEngineBridge";
import { localSuccessFederation, localSuccessStore } from "./localSuccessStorage";
import { assertPlatformCapability, platformPolicy } from "./platformPolicy";
import { currentInferenceMode } from "./inferenceModeSetting";
import type { InferenceMode } from "@builderforce/local-first";

/** Where one turn will run, and with which model. */
export interface ModelRoute {
  /** The ref to send. Undefined means "let the gateway route". */
  model?: string;
  modelStrict?: boolean;
  /** Absent = let the gateway route by the account's `cloudOrder` (see `modelState`). */
  routingMode?: "auto" | "byo_pool";
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
  /**
   * The person's inference mode for this turn (`inferenceModeSetting`). `local-only`
   * never reaches the gateway: the turn is served on this machine or fails
   * `no_local_model`, and it never needs an account.
   */
  inferenceMode?: InferenceMode;
  /**
   * Specific, on a provider only this machine can reach (registry `gatewayVendor` — Kimi
   * Code), whose credential could not be resolved. The gateway cannot serve that pick
   * either, so the turn fails with WHY ({@link routeStream}) instead of reaching a server
   * that answers `local_egress_required`.
   */
  unauthorized?: { provider: LocalRuntimeId; detail: string };
  /**
   * Hybrid: the connected accounts this editor calls itself (Kimi), read per Auto call and
   * tried after this device and before the gateway (`createHostModelStream`).
   */
  accounts?: () => Promise<readonly LocalFirstAccount[]>;
}

/** The error a turn on an {@link ModelRoute.unauthorized} route fails with. */
function unauthorizedError(unauthorized: NonNullable<ModelRoute["unauthorized"]>): Error {
  const label = localRuntime(unauthorized.provider).label;
  return new Error(
    `${label} could not be authorized on this machine, so this turn was not sent. ${unauthorized.detail} `
      + `Sign in again in ${label}, or connect it with "BuilderForce: Manage Model Provider Connections".`,
  );
}

/** Who is asking for a route. */
export interface RouteRequest {
  /** A chat turn is about to run on the answer — the one caller that may start
   *  provisioning a local model (a panel opening or a workspace scan never does). */
  turn?: boolean;
}

/**
 * Resolve the route for a turn. Safe to call signed out — every lookup underneath is
 * best-effort — which is what lets a caller ask BEFORE deciding whether sign-in is
 * required (see {@link routeRequiresSignIn}).
 */
export async function resolveModelRoute(secrets: vscode.SecretStorage, request: RouteRequest = {}): Promise<ModelRoute> {
  const inferenceMode = currentInferenceMode();
  const route = await resolveChoiceRoute(secrets, { ...(await resolveEffectiveModelChoice(secrets)), inferenceMode }, request);
  if (inferenceMode === "hybrid") return { ...route, accounts: () => editorAccounts(secrets).hybridAccounts() };
  return route.inferenceMode === "local-only" && !route.local && !route.localFirst ? onDeviceOnly(route, request) : route;
}

/**
 * The runtimes an UNPINNED turn may try on this machine — and, for a real turn the first
 * time it finds no Bonsai cached, Synapse's engine in the editor starts provisioning one
 * for the turns after it (`hostBfi/provision.ts`; a no-op without the native engine or
 * after the session's one attempt). Gated exactly like the probe: local models on,
 * local-first on.
 */
async function unpinnedLocalProbes(config: LocalModelsConfig, request: RouteRequest): Promise<LocalRuntimeProbe[]> {
  if (request.turn && config.enabled && config.localFirst) hostModelProvisioner.ensure();
  return probeLocalFirstRuntimes(config);
}

/**
 * LOCAL ONLY with no local route yet — a gateway model chosen, or a pin this machine
 * cannot serve: the turn still runs on this machine, on whatever the runtimes offer (the
 * shared stream sets the gateway pick aside). Nothing probed ⇒ the route stays as it is,
 * and `routeStream` fails it `no_local_model`.
 */
async function onDeviceOnly(route: ModelRoute, request: RouteRequest): Promise<ModelRoute> {
  const probes = await unpinnedLocalProbes(getLocalModelsConfig(), request);
  return probes.some((p) => p.models.length > 0) ? { ...route, localFirst: { probes } } : route;
}

async function resolveChoiceRoute(secrets: vscode.SecretStorage, choice: ModelRoute, request: RouteRequest): Promise<ModelRoute> {
  const config = getLocalModelsConfig();
  // `clientPinOf`, not the bare local grammar: the picker lists a connected Kimi account's
  // models as `direct/kimi-code/…`, and only this machine can reach Kimi — that pick must
  // reach the authorizer below (CLI login, else the workspace connect), not the gateway.
  const pin = clientPinOf(choice.model);
  if (!pin) return withLocalFirst(choice, config, request);
  // A model the chat webview runs (`local/bfi/…`, `local/webllm/…`) is served over the
  // page-engine bridge: it needs a port for its runtime, not a configured endpoint — the
  // webview, or for a runtime the registry lets fall back to the host (`bfi`) the
  // extension host's own worker once a model file is cached (`hostBfi/`). With neither,
  // the turn goes to the gateway rather than failing — exactly like a pin whose runtime
  // was removed.
  // Local only: a runtime that leaves this machine (the registry's `onDevice: false` —
  // Kimi Code) is never dispatched or authorized; the caller routes the turn on-device.
  if (choice.inferenceMode === "local-only" && !localRuntime(pin.provider).onDevice) return choice;
  const page = pageRuntimePin(choice.model);
  if (page) return hostPageEngines.connected(page.provider) ? { ...choice, local: page } : choice;
  // A pin can outlive the thing it points at — an on-device runtime removed from
  // settings. No endpoint means no local route, so the turn falls back to the gateway
  // rather than dispatching at `undefined`. Kimi is the exception: its endpoint comes
  // WITH its credential, so a Kimi pin with nothing on this machine yet still goes to the
  // authorizer — which offers to connect the account instead of quietly swapping models.
  const endpoint = config.endpoints[pin.provider];
  if (!endpoint && pin.provider !== "kimi-code") return choice;
  // Credential resolved HERE, once per turn, because it is the last async moment before
  // the transport is built — `routeStream` is synchronous by design and a fifteen-minute
  // Kimi token cannot be refreshed from inside it. A provider that cannot authorize falls
  // back to the gateway rather than dispatching a request that is certain to 401.
  const authorized = await authorizeLocalEndpoint(pin.provider, endpoint, secrets, { interactive: request.turn === true });
  if (!authorized.ok) {
    // Only Specific promises the pick and nothing else; Hybrid answers with Auto.
    const failTurn = choice.inferenceMode === "specific" && localRuntime(pin.provider).gatewayVendor !== undefined;
    if (request.turn) logLine(`[route] ${choice.model} could not run on this machine (${authorized.detail}); ${failTurn ? "failing the turn" : "routing to the gateway"}.`);
    return failTurn ? { ...choice, unauthorized: { provider: pin.provider, detail: authorized.detail } } : choice;
  }
  if (request.turn) logLine(`[route] ${choice.model} runs on this machine via ${pin.provider}.`);
  return { ...choice, local: { ...pin, endpoint: authorized.endpoint } };
}

/**
 * LOCAL FIRST for an unpinned turn. Any model choice — an explicit pick, the project's
 * Evermind pin, a role pin, the configured default — names what the user wants and wins
 * outright, and so does an explicit "use my connected accounts" (`byo_pool`); only "let
 * the gateway route" is open to being served on this machine first (`localFirstApplies`,
 * the rule the web app's stream reads too). Probing is memoized in `localModels`, so
 * asking per turn costs nothing while nothing changed.
 */
async function withLocalFirst(choice: ModelRoute, config: LocalModelsConfig, request: RouteRequest): Promise<ModelRoute> {
  if (!localFirstApplies(choice)) return choice;
  const probes = await unpinnedLocalProbes(config, request);
  if (!probes.some((p) => p.models.length > 0)) return choice;
  return { ...choice, localFirst: { probes } };
}

/**
 * The live on-device runtimes as the run's window gate reads them — the SAME memoized
 * probe the local-first route uses, so a move onto a local model is packed for the
 * window that runtime actually reports.
 */
export function localWindowProbes(): Promise<LocalRuntimeProbe[]> {
  return probeLocalFirstRuntimes(getLocalModelsConfig());
}

/**
 * Whether this route needs a BuilderForce account. A local turn does not: it is served by
 * hardware the user already owns, so gating it on sign-in would be gating them out of
 * their own machine. A local-first turn does not either — signed out, it simply has no
 * cloud to fall back to.
 */
export function routeRequiresSignIn(route: ModelRoute): boolean {
  // Local only never reaches the gateway, so it never owes an account either.
  return route.inferenceMode !== "local-only" && route.local === undefined && route.localFirst === undefined;
}

/** Whether this route may never reach the gateway (Local only). */
function localOnly(route: ModelRoute): boolean {
  return route.inferenceMode === "local-only";
}

/**
 * Whether this route has nowhere to run: Local only, with nothing on this machine that
 * could take the turn. A surface asks it BEFORE the sign-in gate and offers the
 * `no_local_model` remedies (`noLocalModelPrompt.ts`) — signing in would not help.
 */
export function routeNeedsLocalModel(route: ModelRoute): boolean {
  return localOnly(route) && !route.local && !route.localFirst;
}

/**
 * Whether this route is Specific model with nothing picked — no model, no local pin and
 * not the BYO pool. Specific promises the pick and nothing else, so the turn fails
 * `no_specific_model` (the shared stream throws it too) and a surface asks it BEFORE the
 * sign-in gate to offer "Pick a model" (`noLocalModelPrompt.ts`).
 */
export function routeNeedsSpecificModel(route: ModelRoute): boolean {
  return route.inferenceMode === "specific" && !route.model && !route.local && route.routingMode !== "byo_pool";
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
 * The streaming completion fn for a route — run by brain-embedded's
 * `createHostModelStream`, the ONE routing step the web app and Rovr run too. The route
 * was resolved up front (`resolveModelRoute`: the pin's endpoint and credential, the
 * local-first probes), so this only hands it over. Every transport is the SAME shared
 * streamer, so the agent loop, tool-call protocol and error mapping are identical either
 * way; a pin still reaches a DIFFERENT model a run-policy failover names, and every local
 * call is packed for its window.
 *
 * `apiKey` may be undefined only when the route is local; a gateway route without a key
 * is a caller that skipped {@link routeRequiresSignIn}, and throwing here is better than
 * sending an unauthenticated turn that fails opaquely at the gateway.
 *
 * `onFallback` is told when Hybrid's pick failed (transport-class) and the turn was
 * answered with Auto — the surface that started the turn shows the one-line notice
 * (the webview through its run host, the chat participant in its response stream).
 */
export function routeStream(
  route: ModelRoute,
  apiKey: string | undefined,
  onFallback?: (event: ModelFallbackEvent) => void,
): BrainStreamFn {
  if (route.unauthorized) throw unauthorizedError(route.unauthorized);
  if (routeNeedsLocalModel(route)) throw new Error(NO_LOCAL_MODEL);
  if (!apiKey && routeRequiresSignIn(route)) throw new Error(NOT_SIGNED_IN);
  const cloud = !localOnly(route) && apiKey && platformPolicy().allows("gateway-inference") ? createNativeStream(getBaseUrl(), apiKey) : null;
  const local = route.local;
  const pinnedRef = local ? formatLocalModelRef(local.provider, local.model) : null;
  return createHostModelStream({
    // The model POLICY (and its strictness) rides on the call from `modelState`; the only
    // host pin is the resolved local one.
    pinned: () => pinnedRef,
    localPin: (ref) => (ref === pinnedRef ? local : null),
    // The turn's local-first probes; for a picked route (none resolved up front) the SAME
    // memoized probe, read only when Hybrid falls back from a failed pick to Auto.
    probes: async () => route.localFirst?.probes ?? localWindowProbes(),
    ...(route.accounts ? { accounts: route.accounts } : {}),
    cloud: () => cloud,
    // The bridge's fetch answers a page runtime's root (`http://bfi.local`, …) from the
    // webview's engines and passes every other runtime's request to the global fetch.
    fetch: hostPageEngines.fetch(),
    onAttempt: logLocalFirstAttempt,
    // The mode shapes the step; signed in, a turn nothing can serve is `no_local_model`
    // (never a sign-in prompt for someone already signed in).
    mode: () => route.inferenceMode ?? "hybrid",
    signedIn: () => !!apiKey,
    // Hybrid's local-success predictor, trained on this machine's routed turns, and its
    // head shared with the turn's project (signed-in Hybrid only — the shared step decides).
    localSuccess: localSuccessStore,
    localSuccessFederation,
    ...(onFallback ? { onFallback } : {}),
  });
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
  if (route.unauthorized) throw unauthorizedError(route.unauthorized);
  if (route.local) return completeLocal(route.local.endpoint, route.local.model, messages, signal, hostPageEngines.fetch());
  if (routeNeedsSpecificModel(route)) throw new Error(NO_SPECIFIC_MODEL);
  const signedIn = Boolean(await getApiKey(secrets));
  if (route.localFirst) {
    const cloudPermitted = !localOnly(route) && platformPolicy().allows("gateway-inference") && signedIn;
    return completeLocalFirst({
      probes: route.localFirst.probes,
      messages,
      cloud: cloudPermitted ? () => complete(secrets, messages, route.model, signal) : null,
      noModel: localOnly(route) || signedIn ? NO_LOCAL_MODEL : NOT_SIGNED_IN,
      fetch: hostPageEngines.fetch(),
      ...(signal ? { signal } : {}),
      onAttempt: logLocalFirstAttempt,
    });
  }
  if (localOnly(route)) throw new Error(NO_LOCAL_MODEL);
  assertPlatformCapability("gateway-inference");
  return complete(secrets, messages, route.model, signal);
}
