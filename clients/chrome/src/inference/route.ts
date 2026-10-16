/**
 * WHERE a Rovr turn runs — local first (this machine's CPU/GPU), failover to the
 * Builderforce gateway.
 *
 * Nothing about the decision is Rovr's own: the plan (which local model may take this
 * call — a tool turn only goes to a model whose runtime says it can take tools), the
 * failover (a local attempt that fails before the person saw output falls over
 * invisibly; one that already streamed owns the turn; Stop is never failed over) and the
 * streamer are brain-embedded's `createLocalFirstStream`, the same one the VS Code host
 * uses. Rovr supplies the probes, the gateway stream and its log hook.
 *
 * Signed out with nothing local that fits, the stream throws `not_signed_in` — the panel
 * answers it with "sign in, or start a local model".
 */
import {
  createLocalFirstStream,
  streamChatCompletion,
  type BrainStreamFn,
  type BrainTransport,
} from '@seanhogg/builderforce-brain-embedded';
import type { LocalEndpoints, LocalFirstAttemptRecord, LocalRuntimeProber } from '@builderforce/local-inference';
import { resolveLoopbackProbes } from './localRuntimes';

export type RouteFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface RovrRouteDeps {
  baseUrl: string;
  fetch: RouteFetch;
  prober: LocalRuntimeProber;
  endpoints(): Promise<LocalEndpoints>;
  /** The gateway credential, or null signed out. */
  key(): Promise<string | null>;
  onAttempt?(record: LocalFirstAttemptRecord): void;
}

/** The gateway streamer for a credential — the cloud leg of every turn. */
export function gatewayStream(baseUrl: string, key: string, fetchImpl: RouteFetch): BrainStreamFn {
  const transport: BrainTransport = { baseUrl, getToken: () => key, fetch: fetchImpl };
  return (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
}

/**
 * The run's streaming fn. Probed and keyed PER CALL: a runtime started mid-run is used
 * from its next turn, and a sign-in mid-run gives the next turn a cloud to fall back to.
 * Probing is memoized by the prober, so asking per call costs nothing while nothing moved.
 */
export function createRovrStream(deps: RovrRouteDeps): BrainStreamFn {
  return async (opts, handlers) => {
    const [probes, key] = await Promise.all([deps.endpoints().then((e) => deps.prober.probe(e)), deps.key()]);
    const stream = createLocalFirstStream({
      probes: resolveLoopbackProbes(probes),
      cloud: key ? gatewayStream(deps.baseUrl, key, deps.fetch) : null,
      fetch: deps.fetch,
      ...(deps.onAttempt ? { onAttempt: deps.onAttempt } : {}),
    });
    return stream(opts, handlers);
  };
}
