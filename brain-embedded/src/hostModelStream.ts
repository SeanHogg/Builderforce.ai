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
 * THE PICK is the person's explicit model choice: the host's own pin, else a model the
 * call names STRICTLY (`modelStrict` is how a host whose picker rides on the call — the
 * web app's selection, the editor's `modelState` — marks the person's pick). A model the
 * call names without it (a run-policy failover, a project pin) is not the pick and keeps
 * the flags its caller gave it.
 *
 * The INFERENCE MODE (`@builderforce/local-first`) decides what the pick means — the four
 * rows the operator set:
 *
 *  - **Local only** never builds a cloud stream: any pick that does not run ON THIS
 *    DEVICE — a gateway model, or a locally dispatched but hosted runtime (the registry's
 *    `onDevice: false`, e.g. Kimi Code) — whether the host's or one the call names, is set
 *    aside so the turn routes onto this device, and with nothing local it fails
 *    `no_local_model`.
 *  - **Hybrid, no pick (Auto):** local first, then the gateway — the probed runtimes
 *    through `createLocalFirstStream`, which owns which calls are open to local-first
 *    (`localFirstApplies`) and the invisible failover; with nothing probed, the gateway.
 *    A connected subscription this host calls itself (`accounts` — Kimi, which refuses our
 *    cloud) is tried after this device and before the gateway, the way the gateway leads
 *    with the tenant's other connected accounts.
 *    With a `localSuccess` store, the engine's `run.local-success` predictor is consulted
 *    before the local attempt — skipped when it is confident the turn would fail there —
 *    and every outcome (local served, local failed → gateway, skipped) trains it. Only
 *    here: Local only has no alternative to local, and Specific makes no local attempt.
 *    With a `localSuccessFederation` too, a SIGNED-IN turn with a project also shares
 *    what the head learned and starts from the fleet's merged head
 *    (`localSuccess/localSuccessFederation.ts`) — never anonymous, Local only or Specific.
 *  - **Hybrid with a pick:** the pick FIRST, never hard-pinned (no `modelStrict`); if it
 *    fails before the person saw any output AND the failure is transport-class (see
 *    {@link isFallbackFailure}: the gateway unreachable, a 5xx, a timeout before any
 *    output, the local engine failing), the turn falls back to Auto — the local engine,
 *    then the gateway — and the host is told (`onFallback`) so the person sees "your pick
 *    failed; answered with Auto", never a silent swap. A refusal the person can act on
 *    (401, 402, 403, a BYO-key error, a plan limit — any 4xx) is TERMINAL: it surfaces so
 *    the shared remedy banner offers the fix. Signed out a gateway pick has nowhere to
 *    run, so the turn goes straight to Auto.
 *  - **Specific with a pick:** exactly that route, hard-pinned (`modelStrict`) — no local
 *    attempt and no fallback. "Use my connected accounts" (`routingMode: 'byo_pool'`) is
 *    a pick of the person's ACCOUNTS, in Hybrid too: the ones this host calls itself
 *    (`accounts` — Kimi) first, then the gateway's BYO pool, which stays strict. Never a
 *    device runtime and never the free pool; with no host accounts, exactly the pool.
 *  - **Specific with no pick:** fails `no_specific_model` — never a silent Hybrid.
 *
 * When no model can serve a turn, the error says WHY: `not_signed_in` only for a person
 * who is signed out and could sign in to fix it; a signed-in person whose cloud route is
 * unavailable, or anyone on Local only, gets `no_local_model` — never a sign-in prompt.
 */

import {
  isLocalModelRef,
  runsOnDevice,
  type LocalEndpoint,
  type LocalFirstAccount,
  type LocalFirstAttemptRecord,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import type { InferenceMode } from '@builderforce/local-first';
import { NO_LOCAL_MODEL, NO_SPECIFIC_MODEL, NOT_SIGNED_IN } from './chatError';
import { pickThenAuto, type ModelFallbackEvent } from './hostPickFallback';
import { createHandoffFit } from './windowFit/packForModel';
import {
  createLocalFirstStream,
  createLocalStream,
  isAccountPoolCall,
  type LocalAttemptFit,
  type LocalFirstStreamInput,
  type LocalFetch,
} from './localFirstTransport';
import { pageRuntimePin, remapBuiltInPin } from './pageEngines/pageRuntimePin';
import { hybridLocalSuccessTurn } from './localSuccess/hybridLocalSuccess';
import { localSuccessRouterFor, scopedLocalSuccessRouter, type LocalSuccessStore, type LocalSuccessTuning } from './localSuccess/localSuccessRouter';
import { localSuccessScope, type LocalSuccessFederation } from './localSuccess/localSuccessFederation';
import type { StreamChatOptions, StreamChatResult, StreamHandlers } from './streamChatCompletion';

export { isFallbackFailure, type ModelFallbackEvent } from './hostPickFallback';

/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module off
 *  the run store's import graph (as `localFirstTransport` does). */
type StreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
type CallOpts = Parameters<StreamFn>[0];

type MaybePromise<T> = T | Promise<T>;

/** Where a local pin runs: its endpoint and the bare id the runtime knows. */
export interface HostLocalPin {
  endpoint: LocalEndpoint;
  model: string;
}

export interface HostModelStreamInput {
  /**
   * The host's own pick, read per call (so a pick applies from the next turn): a
   * `local/…` ref or a gateway model id; null/absent = no host pin, and a model the call
   * names strictly is the pick (see the module comment).
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
  /**
   * The connected accounts this host calls itself (Kimi), read per Hybrid Auto call and per
   * "use my connected accounts" call (Hybrid or Specific) — never prompting; an account
   * that is not connected is simply absent. Absent = none (the web
   * app, which cannot reach Kimi).
   */
  accounts?: () => Promise<readonly LocalFirstAccount[]>;
  /** The gateway stream for this call, or null signed out. */
  cloud: () => MaybePromise<StreamFn | null>;
  /** The local fetch (page engines' shim, the editor's bridge…); the global by default. */
  fetch?: LocalFetch;
  /** Packs each local call for its model's window; the shared hand-off packer by default. */
  fit?: LocalAttemptFit;
  /** Each settled local-first attempt — a host's log hook. */
  onAttempt?: (record: LocalFirstAttemptRecord) => void;
  /** The person's inference mode, read per call; absent = `hybrid` (the gateway allowed). */
  mode?: () => MaybePromise<InferenceMode>;
  /**
   * Whether the person is signed in, read per call — decides which error a turn nothing
   * can serve fails with (see the module comment). Absent = signed in exactly when
   * `cloud` returned a stream.
   */
  signedIn?: () => MaybePromise<boolean>;
  /**
   * Hybrid's pick failed (transport-class, before any output) and the turn was answered
   * with Auto instead. Every host shows the one-line notice ("Your pick X failed;
   * answered with Auto") — a fallback is never silent.
   */
  onFallback?: (event: ModelFallbackEvent) => void;
  /**
   * Where this host persists the `run.local-success` predictor (browser storage on the
   * web and in Rovr, the extension's global storage in VS Code). Absent = no predictor:
   * Hybrid always tries local first, as before. See `localSuccess/localSuccessRouter.ts`.
   */
  localSuccess?: LocalSuccessStore;
  /**
   * When the predictor's "fails" verdict skips local (the editor's
   * `builderforce.localModels.skipConfidence` / `.explore`); getters are read per turn.
   * Absent = the defaults (`LOCAL_SKIP_CONFIDENCE`, `LOCAL_SKIP_EXPLORE`).
   */
  localSuccessTuning?: LocalSuccessTuning;
  /**
   * How this host federates that predictor's head with its project's fleet (its own
   * authed transport, built with `createLocalSuccessFederation`). Absent = the head
   * stays on this device. Used only with `localSuccess`, on a signed-in Hybrid turn.
   */
  localSuccessFederation?: LocalSuccessFederation;
}

/**
 * The connected accounts could not be read (a storage or permission failure): the turn goes
 * on without them — device, then the gateway — and the reason is logged, not dropped.
 */
function accountsUnavailable(error: unknown): LocalFirstAccount[] {
  console.warn(`Hybrid: connected accounts unavailable for this call (${error instanceof Error ? error.message : String(error)})`);
  return [];
}

/** Packs a local attempt for its model's window — `@seanhogg/builderforce-memory/handoff`.
 *  One per process; its pack memo is kept per conversation (the call's `conversationKey`). */
const handoffFit = createHandoffFit();

/** The ONE host routing step: see the module comment for the rows it decides. */
export function createHostModelStream(input: HostModelStreamInput): StreamFn {
  const resolvePin = input.localPin ?? pageRuntimePin;
  /** A local ref's route and the ref it runs as. A built-in-model pin naming another
   *  vendor's model runs on THIS browser's, and the host is told — a remap is never silent. */
  const resolveLocal = (ref: string): { pin: HostLocalPin; ref: string; remapped: boolean } | null => {
    const found = resolvePin(ref);
    if (!found) return null;
    const remap = remapBuiltInPin(ref, found);
    if (remap) input.onFallback?.({ from: ref, to: remap.ref, code: 'PIN_REMAPPED', reason: 'PIN_REMAPPED' });
    return { pin: remap?.pin ?? found, ref: remap?.ref ?? ref, remapped: remap !== null };
  };
  const fit = input.fit ?? handoffFit;
  return async (callOpts, handlers = {}) => {
    const mode: InferenceMode = (await input.mode?.()) ?? 'hybrid';
    const localOnly = mode === 'local-only';
    const hostPin = (await input.pinned?.()) ?? null;
    // Local only: a pick that does not run on this device has nowhere to go, so it is set
    // aside rather than failed — and a call naming one (or the BYO pool) routes like an
    // unpinned one.
    const opts = localOnly ? onDeviceOnly(callOpts) : callOpts;
    const pick = localOnly
      ? (hostPin && runsOnDevice(hostPin) ? hostPin : null)
      : hostPin ?? (opts.modelStrict && opts.model ? opts.model : null);
    // "Use my connected accounts" is a pick too — of the BYO pool rather than one model.
    const byoPool = !localOnly && opts.routingMode === 'byo_pool';
    // Specific promises the pick and nothing else: no pick is an error, not a quiet Auto.
    if (mode === 'specific' && !pick && !byoPool) throw new Error(NO_SPECIFIC_MODEL);
    // Local only never BUILDS a cloud stream — not merely never calls one.
    const cloud = localOnly ? null : await input.cloud();
    const signedIn = !localOnly && (input.signedIn ? await input.signedIn() : cloud !== null);
    const noModel = localOnly || signedIn ? NO_LOCAL_MODEL : NOT_SIGNED_IN;

    /** The connected accounts this host calls itself, read per call; none when unreadable or unlent. */
    const readAccounts = async (): Promise<readonly LocalFirstAccount[]> =>
      input.accounts ? input.accounts().catch(accountsUnavailable) : [];
    /** The one local-first stream assembly — Auto's, and the account pool's (no probes, no predictor). */
    const localFirst = (
      probes: readonly LocalRuntimeProbe[],
      accounts: readonly LocalFirstAccount[],
      onAttempt: ((record: LocalFirstAttemptRecord) => void) | undefined = input.onAttempt,
      gate?: LocalFirstStreamInput['gate'],
    ): StreamFn => createLocalFirstStream({
      probes,
      ...(accounts.length > 0 ? { accounts } : {}),
      cloud,
      fit,
      noModel,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(onAttempt ? { onAttempt } : {}),
      ...(gate ? { gate } : {}),
    });

    /** Auto: local first (when anything is probed), then the gateway. */
    const auto = async (call: CallOpts, h: StreamHandlers): Promise<StreamChatResult> => {
      const localRef = call.model;
      const local = localRef ? resolveLocal(localRef) : null;
      if (local && localRef) {
        return createLocalStream(local.pin.endpoint, local.pin.model, input.fetch, { ref: local.ref, cloud, fit })(
          local.remapped ? { ...call, model: local.ref } : call,
          h,
        );
      }
      const probes = input.probes ? await input.probes() : [];
      // Hybrid only: Local only never leaves the device, and Specific makes no Auto attempt.
      const accounts = mode === 'hybrid' ? await readAccounts() : [];
      if (probes.length === 0 && accounts.length === 0) {
        if (!cloud) throw new Error(noModel);
        return cloud(call, h);
      }
      // Hybrid with a cloud to go to is the only row where skipping local is a choice.
      // Federating additionally needs a signed-in person and a project to share with.
      const learned = mode === 'hybrid' && cloud && input.localSuccess
        ? hybridLocalSuccessTurn(
          scopedLocalSuccessRouter(
            localSuccessRouterFor(input.localSuccess, input.localSuccessTuning),
            signedIn ? await localSuccessScope(input.localSuccessFederation, call.metadata?.projectId) : undefined,
          ),
          probes,
          call.signal,
        )
        : null;
      const onAttempt = learned || input.onAttempt
        ? (record: LocalFirstAttemptRecord) => {
            learned?.onAttempt(record);
            input.onAttempt?.(record);
          }
        : undefined;
      const stream = localFirst(probes, accounts, onAttempt, learned?.gate);
      if (!learned) return stream(call, h);
      try {
        const result = await stream(call, h);
        learned.settle();
        return result;
      } catch (err) {
        learned.settle(err);
        throw err;
      }
    };

    // No pick (Hybrid Auto, or Local only with nothing on-device picked): the call routes
    // as it stands — a local ref it names runs where it runs, anything else local first.
    const strict = mode === 'specific';
    if (!pick) {
      // "Use my connected accounts" (Hybrid and Specific): the person's ACCOUNTS — those this
      // host calls itself (Kimi) first, then the gateway's BYO pool (still strict). Never a
      // device runtime and never the free pool, so no probes and no local-success predictor.
      if (isAccountPoolCall(opts)) {
        const accounts = await readAccounts();
        if (accounts.length > 0) return localFirst([], accounts)(opts, handlers);
      }
      if (strict) {
        if (!cloud) throw new Error(noModel);
        return cloud(opts, handlers);
      }
      return auto(opts, handlers);
    }

    const local = resolveLocal(pick);
    const pickRef = local?.ref ?? pick;
    // The call may carry the old pin as its model: it names the remapped one now.
    const pinOpts = local?.remapped && opts.model === pick ? { ...opts, model: pickRef } : opts;
    /** The pick's own route — on its runtime, or at the gateway (strict only under Specific). */
    const pinned = (h: StreamHandlers): Promise<StreamChatResult> => {
      if (local) {
        // Specific hands the pin no cloud: a call naming another model stays on the pin.
        return createLocalStream(local.pin.endpoint, local.pin.model, input.fetch, { ref: pickRef, cloud: strict ? null : cloud, fit })(pinOpts, h);
      }
      if (isLocalModelRef(pick) || !cloud) throw new Error(isLocalModelRef(pick) ? NO_LOCAL_MODEL : noModel);
      return cloud({ ...opts, model: pick, modelStrict: strict }, h);
    };
    if (strict) return pinned(handlers);
    // Hybrid: a gateway pick signed out (or a local pick this host cannot serve) has
    // nowhere to run — straight to Auto.
    if (!local && (isLocalModelRef(pick) || !cloud)) return auto(unpicked(opts), handlers);
    return pickThenAuto(pinned, () => auto(unpicked(opts), handlers), handlers, opts.signal, {
      from: pickRef,
      local: !!local,
      ...(input.onFallback ? { onFallback: input.onFallback } : {}),
    });
  };
}

/**
 * The call as Auto sends it: the pick and its strictness dropped. `routingMode` is
 * dropped too — never stamped `'auto'` — so the gateway applies the ACCOUNT's cloud
 * funding order (an absent routingMode is "the account's order"; an explicit `'auto'`
 * overrode it).
 */
function unpicked(opts: CallOpts): CallOpts {
  const { modelStrict: _strict, model: _model, routingMode: _routing, ...rest } = opts;
  return rest;
}

/** A call as Local only may send it: a model that leaves the device or the BYO pool is
 *  dropped (the turn routes on this device); an on-device ref stays. */
function onDeviceOnly(opts: CallOpts): CallOpts {
  const offDevice = !!opts.model && !runsOnDevice(opts.model);
  if (!offDevice && (opts.routingMode ?? 'auto') === 'auto') return opts;
  const { modelStrict: _strict, model, ...rest } = opts;
  return { ...rest, ...(offDevice || !model ? {} : { model }), routingMode: 'auto' };
}
