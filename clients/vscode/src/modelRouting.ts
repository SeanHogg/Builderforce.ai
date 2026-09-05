/**
 * WHERE a turn runs — the ONE place that answers it, for every AI surface in the editor.
 *
 * Two questions have to be answered together and were previously answered apart:
 *
 *   1. WHICH model serves this turn (an explicit pick, the project's Evermind, the
 *      configured default, or gateway auto) — `modelState.resolveEffectiveModelChoice`;
 *   2. WHICH transport that implies — the gateway, or a runtime on this machine.
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
import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { authorizeLocalEndpoint, complete, getBaseUrl, getLocalModelsConfig, type ChatMessage } from "./gateway";
import {
  completeLocal,
  createLocalStream,
  parseLocalModelRef,
  type LocalEndpoint,
  type LocalProviderId,
} from "./localModels";
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
  local?: { provider: LocalProviderId; model: string; endpoint: LocalEndpoint };
}

/**
 * Resolve the route for a turn. Safe to call signed out — every lookup underneath is
 * best-effort — which is what lets a caller ask BEFORE deciding whether sign-in is
 * required (see {@link routeRequiresSignIn}).
 */
export async function resolveModelRoute(secrets: vscode.SecretStorage): Promise<ModelRoute> {
  const choice = await resolveEffectiveModelChoice(secrets);
  const pin = parseLocalModelRef(choice.model);
  if (!pin) return choice;
  // A pin can outlive the thing it points at — a Kimi install signed out since the model
  // was chosen, an on-device runtime removed from settings. No endpoint means no local
  // route, so the turn falls back to the gateway rather than dispatching at `undefined`.
  const endpoint = getLocalModelsConfig().endpoints[pin.provider];
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
 * Whether this route needs a BuilderForce account. A local turn does not: it is served by
 * hardware the user already owns, so gating it on sign-in would be gating them out of
 * their own machine.
 */
export function routeRequiresSignIn(route: ModelRoute): boolean {
  return route.local === undefined;
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
  return complete(secrets, messages, route.model, signal);
}
