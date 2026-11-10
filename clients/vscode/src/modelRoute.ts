/**
 * The {@link ModelRoute} contract — where one turn runs, and with which model — and the
 * error an unauthorized route fails with. Pure data: resolving a route and choosing its
 * transport stay together in `modelRouting.ts` (the ONE router; `modelRouting.test.ts`
 * guards that no other module reaches for a transport).
 */

import {
  localRuntime,
  type LocalEndpoint,
  type LocalFirstAccount,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from "@builderforce/local-inference";
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
   * either, so the turn fails with WHY (`routeStream`) instead of reaching a server
   * that answers `local_egress_required`.
   */
  unauthorized?: { provider: LocalRuntimeId; detail: string };
  /**
   * Hybrid, a real turn: the pick could not be authorized on this machine, so the turn is
   * answered with Auto. Carried so `routeStream` tells the person through the same
   * fallback notice a failed pick gets, instead of free models answering unexplained.
   */
  pickUnavailable?: { model: string; detail: string };
  /**
   * The connected accounts this editor calls itself (Kimi), read per call: in Hybrid Auto,
   * tried after this device and before the gateway; for "use my connected accounts"
   * (`byo_pool`, Hybrid or Specific), tried first, then the gateway's BYO pool
   * (`createHostModelStream`). Never set for Local only.
   */
  accounts?: () => Promise<readonly LocalFirstAccount[]>;
}

/** Who is asking for a route. */
export interface RouteRequest {
  /** A chat turn is about to run on the answer — the one caller that may start
   *  provisioning a local model (a panel opening or a workspace scan never does). */
  turn?: boolean;
}

/** The error a turn on an {@link ModelRoute.unauthorized} route fails with. */
export function unauthorizedError(unauthorized: NonNullable<ModelRoute["unauthorized"]>): Error {
  const label = localRuntime(unauthorized.provider).label;
  return new Error(
    `${label} could not be authorized on this machine, so this turn was not sent. ${unauthorized.detail} `
      + `Sign in again in ${label}, or connect it with "BuilderForce: Manage Model Provider Connections".`,
  );
}
