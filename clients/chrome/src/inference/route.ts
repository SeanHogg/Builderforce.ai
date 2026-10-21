/**
 * WHERE a Rovr turn runs — local first (this machine's CPU/GPU), failover to the
 * Builderforce gateway.
 *
 * Nothing about the decision is Rovr's own: the plan (which local model may take this
 * call — a tool turn only goes to a model whose runtime says it can take tools), the
 * failover (a local attempt that fails before the person saw output falls over
 * invisibly; one that already streamed owns the turn; Stop is never failed over), the pin
 * handling and the streamer are brain-embedded's `createHostModelStream`, the same routing
 * step the web app and the VS Code host run. Rovr supplies its picker's pin, the probes,
 * the gateway stream and its log hook.
 *
 * The engines that run inside the side panel itself (brain-embedded's page engines —
 * Chrome's built-in Gemini Nano, WebLLM models and the WebGPU `bfi` the person
 * downloaded) are more local runtimes here: their probes join the loopback ones and their
 * ONE fetch shim answers their chat routes. The registry ranks them after every installed
 * runtime, and the plan hands a tool turn only to a model that can take one.
 *
 * The person's INFERENCE MODE (`policy.ts`) rides on every call: Local only never builds
 * the gateway stream, and the gateway leg exists only while the platform policy allows
 * gateway inference. With nothing local that fits, the stream throws `not_signed_in`
 * signed out ("sign in, or start a local model") and `no_local_model` on Local only or
 * signed in with no cloud route ("switch to Hybrid, or download a local model") — a
 * signed-in person is never asked to sign in.
 */
import {
  createHostModelStream,
  pageRuntimePin,
  streamChatCompletion,
  withUsageSurface,
  type BrainStreamFn,
  type BrainTransport,
  type HostLocalPin,
  type LocalSuccessFederation,
  type LocalSuccessStore,
  type ModelFallbackEvent,
} from '@seanhogg/builderforce-brain-embedded';
import type { InferenceMode } from '@builderforce/local-first';
import type {
  LocalEndpoints,
  LocalFirstAttemptRecord,
  LocalRuntimeProbe,
  LocalRuntimeProber,
} from '@builderforce/local-inference';
import { resolveLoopbackProbes } from './localRuntimes';

export type RouteFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface RovrRouteDeps {
  baseUrl: string;
  fetch: RouteFetch;
  prober: LocalRuntimeProber;
  endpoints(): Promise<LocalEndpoints>;
  /** The gateway credential, or null signed out. */
  key(): Promise<string | null>;
  /**
   * The in-page engines (brain-embedded's `createPageEngineSet`). Their probes join the
   * HTTP runtimes' and their fetch carries the local attempts; absent = HTTP runtimes only.
   */
  page?: { probe(): Promise<LocalRuntimeProbe[]>; fetch: RouteFetch };
  /**
   * The model the person pinned in the side panel's picker (Rovr settings), or null for
   * automatic routing. Read per call, so a pick applies from the next turn.
   */
  pinned?(): Promise<string | null>;
  /**
   * Where a pin served by a CONNECTED ACCOUNT runs (a Kimi model, called from this browser
   * with the workspace's short-lived token), or null for a ref it does not own. Async —
   * the token may need fetching — so it is resolved in the pin step and handed to the
   * synchronous `localPin` below. May throw `ProviderConnectRequired`.
   */
  accountPin?(ref: string): Promise<HostLocalPin | null>;
  onAttempt?(record: LocalFirstAttemptRecord): void;
  /** The person's inference mode, read per call; absent = Hybrid. */
  mode?(): InferenceMode;
  /** Whether the platform policy lets this turn reach the gateway; absent = yes. */
  gatewayAllowed?(): boolean;
  /** Hybrid's pick failed (transport-class) and the turn was answered with Auto — the
   *  panel shows the one-line notice. */
  onFallback?(event: ModelFallbackEvent): void;
  /** Where Hybrid's local-success predictor is kept (the panel's extension storage). */
  localSuccess?: LocalSuccessStore;
  /** How that predictor's head federates with the project's fleet (signed-in Hybrid only — the shared step decides). */
  localSuccessFederation?: LocalSuccessFederation;
}

/**
 * The gateway streamer for a credential — the cloud leg of every turn. Every call is
 * tagged `rovr`, so the usage ledger reports what the side panel spent as its own.
 */
export function gatewayStream(baseUrl: string, key: string, fetchImpl: RouteFetch): BrainStreamFn {
  const transport: BrainTransport = { baseUrl, getToken: () => key, fetch: withUsageSurface(fetchImpl, 'rovr') };
  return (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
}

/**
 * The run's streaming fn. Probed and keyed PER CALL: a runtime started mid-run is used
 * from its next turn, and a sign-in mid-run gives the next turn a cloud to fall back to.
 * Probing is memoized by the prober, so asking per call costs nothing while nothing moved.
 */
export function createRovrStream(deps: RovrRouteDeps): BrainStreamFn {
  // The account pins resolved for the refs in flight, keyed by ref so two concurrent turns
  // on different pins never read each other's endpoint.
  const accountPins = new Map<string, HostLocalPin>();
  return createHostModelStream({
    // The picker's pick: a page model (`local/bfi/…`, `local/webllm/…`) runs in this panel
    // through the engines' fetch; a gateway model goes to the gateway. What the pick means
    // is the mode's (the shared step): Hybrid tries it first and falls back to Auto,
    // Specific hard-pins it with no fallback. A page pin this panel cannot serve (no page
    // engines) routes automatically under Hybrid.
    pinned: async () => {
      const ref = deps.pinned ? await deps.pinned() : null;
      // A connected account's endpoint is hosted — it leaves the device — so Local only
      // never resolves (or fetches a token for) one; the shared step sets the pin aside.
      const account = ref && deps.accountPin && deps.mode?.() !== 'local-only' ? await deps.accountPin(ref) : null;
      if (ref && account) accountPins.set(ref, account);
      return ref;
    },
    localPin: (ref) => accountPins.get(ref) ?? (deps.page ? pageRuntimePin(ref) : null),
    probes: async () => {
      const [probes, page] = await Promise.all([
        deps.endpoints().then((e) => deps.prober.probe(e)),
        deps.page ? deps.page.probe() : Promise.resolve([]),
      ]);
      return [...resolveLoopbackProbes(probes), ...page];
    },
    cloud: async () => {
      const key = await deps.key();
      if (!key || (deps.gatewayAllowed && !deps.gatewayAllowed())) return null;
      return gatewayStream(deps.baseUrl, key, deps.fetch);
    },
    signedIn: async () => (await deps.key()) !== null,
    ...(deps.mode ? { mode: deps.mode } : {}),
    fetch: deps.page?.fetch ?? deps.fetch,
    ...(deps.onAttempt ? { onAttempt: deps.onAttempt } : {}),
    ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
    ...(deps.localSuccess ? { localSuccess: deps.localSuccess } : {}),
    ...(deps.localSuccessFederation ? { localSuccessFederation: deps.localSuccessFederation } : {}),
  });
}
