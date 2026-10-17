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
 * Signed out with nothing local that fits, the stream throws `not_signed_in` — the panel
 * answers it with "sign in, or start a local model".
 */
import {
  createHostModelStream,
  pageRuntimePin,
  streamChatCompletion,
  withUsageSurface,
  type BrainStreamFn,
  type BrainTransport,
} from '@seanhogg/builderforce-brain-embedded';
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
  onAttempt?(record: LocalFirstAttemptRecord): void;
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
  return createHostModelStream({
    // The picker's pick: a page model (`local/bfi/…`, `local/webllm/…`) runs in this panel
    // through the engines' fetch — a pin is a pin, no probe of anything else; a gateway
    // model goes to the gateway hard-pinned. A page pin this panel cannot serve (no page
    // engines) routes automatically.
    pinned: async () => (deps.pinned ? await deps.pinned() : null),
    localPin: (ref) => (deps.page ? pageRuntimePin(ref) : null),
    probes: async () => {
      const [probes, page] = await Promise.all([
        deps.endpoints().then((e) => deps.prober.probe(e)),
        deps.page ? deps.page.probe() : Promise.resolve([]),
      ]);
      return [...resolveLoopbackProbes(probes), ...page];
    },
    cloud: async () => {
      const key = await deps.key();
      return key ? gatewayStream(deps.baseUrl, key, deps.fetch) : null;
    },
    fetch: deps.page?.fetch ?? deps.fetch,
    ...(deps.onAttempt ? { onAttempt: deps.onAttempt } : {}),
  });
}
