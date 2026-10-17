/**
 * THE routing step every host runs before a Brain call — pinned model, pinned local
 * runtime, or LOCAL FIRST with failover to the gateway — composed once.
 *
 * The web app, Rovr (the Chrome side panel) and the VS Code extension host each used to
 * write this step themselves around `createLocalStream` / `createLocalFirstStream`, each
 * with its own hand-off fit, and they drifted: one re-checked `localFirstApplies` the
 * local-first stream already reads, one hard-pinned a picked gateway model the others did
 * not. A host now supplies only what differs between hosts — where its pin comes from,
 * how a local pin resolves to an endpoint, what it probes, its gateway stream and fetch —
 * and gets the one streaming fn back.
 *
 * Per call, in order:
 *
 *  1. A LOCAL pin — the host's own pin, else a `local/…` ref the call names — that this
 *     host can serve takes the ONE pinned-local path (`createLocalStream`): packed for the
 *     pin's window, and a call naming a different model still reaches where it runs.
 *  2. A host-pinned GATEWAY model (the person's explicit pick from a picker) goes straight
 *     to the gateway, hard-pinned (`modelStrict`) so validation cannot swap it. Signed out
 *     it has nowhere to run, so the call routes automatically like an unpinned one. A model
 *     the CALL names (a run-policy failover, a project pin) keeps the strictness the caller
 *     gave it — only the host's own pin is the person's pick.
 *  3. Otherwise the probed runtimes: none = the gateway untouched (or `not_signed_in`
 *     signed out); some = `createLocalFirstStream`, which owns which calls are open to
 *     local-first (`localFirstApplies`) and the invisible failover.
 */

import { isLocalModelRef, type LocalEndpoint, type LocalFirstAttemptRecord, type LocalRuntimeProbe } from '@builderforce/local-inference';
import { NOT_SIGNED_IN } from './chatError';
import { createHandoffFit } from './windowFit/packForModel';
import {
  createLocalFirstStream,
  createLocalStream,
  type LocalAttemptFit,
  type LocalFetch,
} from './localFirstTransport';
import { pageRuntimePin } from './pageEngines/pageRuntimePin';
import type { StreamChatOptions, StreamChatResult, StreamHandlers } from './streamChatCompletion';

/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module off
 *  the run store's import graph (as `localFirstTransport` does). */
type StreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;

type MaybePromise<T> = T | Promise<T>;

/** Where a local pin runs: its endpoint and the bare id the runtime knows. */
export interface HostLocalPin {
  endpoint: LocalEndpoint;
  model: string;
}

export interface HostModelStreamInput {
  /**
   * The host's own pick, read per call (so a pick applies from the next turn): a
   * `local/…` ref or a gateway model id; null/absent = no host pin, and the call's own
   * `model` is honoured as it stands.
   */
  pinned?: () => MaybePromise<string | null | undefined>;
  /**
   * Resolves a local ref to where it runs, or null when this host cannot serve it (the
   * call then routes automatically). Default: {@link pageRuntimePin} — a model running in
   * this page's engines.
   */
  localPin?: (ref: string) => HostLocalPin | null | undefined;
  /** The runtimes to try local-first, probed WITH capabilities; absent = gateway only. */
  probes?: () => Promise<readonly LocalRuntimeProbe[]>;
  /** The gateway stream for this call, or null signed out. */
  cloud: () => MaybePromise<StreamFn | null>;
  /** The local fetch (page engines' shim, the editor's bridge…); the global by default. */
  fetch?: LocalFetch;
  /** Packs each local call for its model's window; the shared hand-off packer by default. */
  fit?: LocalAttemptFit;
  /** Each settled local-first attempt — a host's log hook. */
  onAttempt?: (record: LocalFirstAttemptRecord) => void;
}

/** Packs a local attempt for its model's window — `@seanhogg/builderforce-memory/handoff`. */
const handoffFit = createHandoffFit();

/** The ONE host routing step: see the module comment for the order it decides in. */
export function createHostModelStream(input: HostModelStreamInput): StreamFn {
  const resolveLocal = input.localPin ?? pageRuntimePin;
  const fit = input.fit ?? handoffFit;
  return async (opts, handlers = {}) => {
    const hostPin = (await input.pinned?.()) ?? null;
    const localRef = hostPin ?? opts.model;
    const local = localRef ? resolveLocal(localRef) : null;
    const cloud = await input.cloud();
    if (local && localRef) {
      return createLocalStream(local.endpoint, local.model, input.fetch, { ref: localRef, cloud, fit })(opts, handlers);
    }
    if (hostPin && !isLocalModelRef(hostPin) && cloud) {
      return cloud({ ...opts, model: hostPin, modelStrict: true }, handlers);
    }
    const probes = input.probes ? await input.probes() : [];
    if (probes.length === 0) {
      if (!cloud) throw new Error(NOT_SIGNED_IN);
      return cloud(opts, handlers);
    }
    return createLocalFirstStream({
      probes,
      cloud,
      fit,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    })(opts, handlers);
  };
}
