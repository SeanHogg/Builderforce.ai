/**
 * The model hand-off policy for ONE agent run, as a pure reducer.
 *
 * Every agent loop answers the same four questions before and after each turn: what
 * kind of call is this (plan, code, verify — or chat when no tools are on offer), which
 * model does it ask for and how strictly, which models must it route around, and when a
 * model is spent, who takes over. Those answers lived inline in the browser Brain's run
 * store, and each other host (the cloud durable and container loops, the server
 * addressed reply, the canvas, on-prem) carried its own partial copy — which is how one
 * loop retried a broken model on eighteen separate turns and another enforced a
 * failover budget over a failover that never happened.
 *
 * Here they are one state machine. A host asks {@link nextTurn} what to request, makes
 * the call, and reports what happened with {@link reduceRunPolicy}; the reduced state's
 * `outcome` says what the host must DO about it (re-ask, retry, fail, continue on a new
 * model). Traces, nudges, persistence and dispatch stay with the host. No I/O, no
 * clocks; the only foreign code that runs is a host-supplied fallback `pick`. The state
 * is plain JSON, so a host that runs one step per invocation (the cloud durable loop,
 * the container `llm` op) persists it between steps as it is.
 */

import type { ModelRole } from '@builderforce/agent-tools';
import {
  MAX_MODEL_FAILOVERS,
  chooseStallFailover,
  nextFallbackModel,
  type ModelFallbackSurface,
} from '@builderforce/agent-stall';

/** The working phase of a tool-using run. Only ever moves forward. */
export type RunPhase = Extract<ModelRole, 'plan' | 'code' | 'verify'>;

/**
 * Gateway statuses that release a pin or lock for the rest of the run: rate-limited
 * (429), context window too small for the request (413), and unavailable — cooled down
 * or a provider outage (503). A pin gets NO in-proxy cascade, so dropping it is what
 * lets the gateway walk its chain instead of the run hard-failing on ONE model.
 */
export const PIN_RELEASE_STATUSES: readonly number[] = [429, 413, 503];

/**
 * The status a DECLINING backend answers with when it will not serve a turn it is not
 * competent for — a project Evermind head whose tool choice ranked no better than the
 * alternatives, or whose prose failed the coherence bar. On a model named by
 * {@link RunPolicyOptions.decliningModelPrefixes} it releases a pin or lock exactly like
 * a {@link PIN_RELEASE_STATUSES} status; on any other model it is the malformed request
 * it says it is, and fails fast.
 */
export const DECLINE_STATUS = 400;

export interface RunPolicyOptions {
  /** The model the run starts on; absent ⇒ the gateway auto-selects. */
  pinnedModel?: string;
  /** Ask the gateway not to cascade off the model. Applies only while one is set. */
  strictPin?: boolean;
  /**
   * Whether a release status ({@link PIN_RELEASE_STATUSES}) may drop the USER's pin.
   * The browser Brain treats a pin as the user's own choice and never routes around it;
   * the cloud loop pins on the run's behalf and drops it rather than fail the run. A
   * LOCK ({@link lockAfterFirstSuccess}) is always releasable.
   */
  pinReleasable?: boolean;
  /**
   * Keep the run on the model the gateway resolved — once a non-strict turn succeeds,
   * every later turn asks for that model (the cloud durable loop, whose DO ticks must
   * not hop models mid-task). A release status unlocks it; the next success re-locks.
   */
  lockAfterFirstSuccess?: boolean;
  /** Where the run starts — a resumed run that already changed code starts at `code`. */
  startPhase?: RunPhase;
  /** Model swaps one run may make after a stall. Defaults to `MAX_MODEL_FAILOVERS`. */
  maxFailovers?: number;
  /**
   * The role every tool turn asks for when the run was delegated ONE kind of work that
   * is not a working phase (an `explore` or `utility` sub-agent). Absent ⇒ the phase
   * (`plan` → `code` → `verify`) decides, which is every run that plans or ships work.
   */
  fixedRole?: ModelRole;
  /**
   * Model-id prefixes whose backend DECLINES a turn with {@link DECLINE_STATUS} (today
   * `evermind/` — a project's own self-learning head). A decline on one of them releases
   * a releasable pin or a lock like a {@link PIN_RELEASE_STATUSES} status, so the run
   * walks the gateway's cascade instead of dying on a head that is still learning.
   */
  decliningModelPrefixes?: readonly string[];
  /**
   * Pin the model a stall failover moves to STRICTLY. A host that fails over onto a
   * model because it already worked in this run (see {@link preferProvenFailover}) must
   * not let the gateway route straight back off it — a soft hint can be shadowed by the
   * tenant's connected-account seed.
   */
  strictFailover?: boolean;
  /**
   * On a stall, fail over first to a model that already ACTED in this run (a turn that
   * succeeded with tool calls — `turn_succeeded{acted: true}`), most recent first, and
   * only then to the host's `pick` / `surface`. A model that has emitted valid tool calls
   * in this very run is the strongest evidence a host holds about who can do the work.
   */
  preferProvenFailover?: boolean;
  /** Models the run routes around from its first turn (failures the session already
   *  proved). They join {@link RunPolicyState.broken}. */
  excludeModels?: readonly string[];
}

/** What the host must do about the event it just reported. */
export type RunPolicyOutcome =
  | { kind: 'none' }
  /** The plan turn reached for a code change: discard it and re-ask THIS turn as `code`
   *  (with `coderHandoffBrief`). */
  | { kind: 'reask_as_coder' }
  /** `hand_off` accepted — every later turn is `code`. */
  | { kind: 'handed_off' }
  /** `hand_off` after the plan was already handed off — answer the call with an error. */
  | { kind: 'hand_off_rejected' }
  /** A transport failure the policy routes around: re-ask this turn now. `broken` is the
   *  model left out for the rest of the run; `released` names a dropped pin/lock. */
  | { kind: 'retry_turn'; broken?: string; released?: string; status?: number }
  /** A transport failure the policy does not route around: the turn fails. */
  | { kind: 'fail_turn' }
  /** The spent model was swapped; the host re-prompts on `to`. */
  | { kind: 'failed_over'; from: string | undefined; to: string; attempt: number; of: number }
  /** Nothing untried within budget — the run stops and says so. */
  | { kind: 'failover_exhausted'; tried: readonly string[] };

export interface RunPolicyState {
  readonly phase: RunPhase;
  /** The model the next turn asks for; undefined ⇒ auto-select. */
  readonly model: string | undefined;
  /** Whether `model` came from a lock rather than the pin or a failover. */
  readonly locked: boolean;
  /** The configured pin while it stands; cleared for good once a release drops it. */
  readonly pin: string | undefined;
  /** Strictness as configured; cleared for good once a pin is released. */
  readonly strictPin: boolean;
  /** Models that broke mid-turn this run — excluded from every later turn. */
  readonly broken: readonly string[];
  /** Models whose turn succeeded WITH tool calls this run, oldest first — the
   *  {@link RunPolicyOptions.preferProvenFailover} candidates. */
  readonly proven: readonly string[];
  /** Every model a stall failover has already burned, asked-for and resolved. */
  readonly tried: readonly string[];
  readonly failovers: number;
  /** Transport retries spent on the CURRENT turn; a success resets it. */
  readonly turnRetries: number;
  readonly outcome: RunPolicyOutcome;
  readonly options: Readonly<
    Required<Pick<RunPolicyOptions,
      'pinReleasable' | 'lockAfterFirstSuccess' | 'maxFailovers' | 'decliningModelPrefixes' | 'strictFailover' | 'preferProvenFailover'>>
    & Pick<RunPolicyOptions, 'fixedRole'>
    /** Whether the configured pin was strict — what a pin the run returns to is asked as. */
    & { pinStrict: boolean }
  >;
}

/** How a request failed in transport — the host classifies, the policy decides. */
export type TransportFailureKind =
  /** The model broke AFTER the gateway committed to it (in-band error, dropped stream). */
  | 'interrupted'
  /** The gateway was reached and the request failed (reset, timeout, HTTP status). */
  | 'transport'
  /** The gateway was never reached — already retried with backoff by the transport. */
  | 'unreachable';

export type RunPolicyEvent =
  /** The turn answered. `model` is what the gateway RESOLVED, when it said; `acted` —
   *  the turn called tools — makes that model a proven failover candidate. */
  | { type: 'turn_succeeded'; model?: string; acted?: boolean }
  /** The turn's tool calls include a code change (the implicit plan→code re-ask). */
  | { type: 'code_change_attempted' }
  /** The model called `hand_off` (planning ends explicitly). */
  | { type: 'hand_off' }
  /** The run moved on to verifying its change. */
  | { type: 'verify_started' }
  /**
   * The model burned its whole stall budget. `resolvedModel` names what answered (the
   * only id on an auto-select turn); `pick` is the host's own fallback picker, `surface`
   * the gateway model surface — `pick` wins when both are present, neither ⇒ no failover
   * (unless the run prefers a proven model and has one).
   */
  | {
      type: 'stalled';
      resolvedModel?: string;
      surface?: ModelFallbackSurface | null;
      pick?: (tried: readonly string[]) => string | undefined;
    }
  | { type: 'transport_failed'; kind: TransportFailureKind; model?: string; status?: number };

/** What the next request asks for. */
export interface TurnRequest {
  role: ModelRole;
  model: string | undefined;
  strict: boolean;
  excludeModels: string[];
}

const NONE: RunPolicyOutcome = { kind: 'none' };

export function initialRunPolicy(opts: RunPolicyOptions = {}): RunPolicyState {
  const model = opts.pinnedModel || undefined;
  return {
    phase: opts.startPhase ?? 'plan',
    model,
    locked: false,
    pin: model,
    // Strictness belongs to a pin. With nothing pinned it would otherwise make the
    // run's first LOCK strict, which no host asks for.
    strictPin: !!opts.strictPin && !!model,
    broken: [...new Set((opts.excludeModels ?? []).filter(Boolean))],
    proven: [],
    tried: [],
    failovers: 0,
    turnRetries: 0,
    outcome: NONE,
    options: {
      pinReleasable: !!opts.pinReleasable,
      lockAfterFirstSuccess: !!opts.lockAfterFirstSuccess,
      maxFailovers: opts.maxFailovers ?? MAX_MODEL_FAILOVERS,
      decliningModelPrefixes: [...(opts.decliningModelPrefixes ?? [])],
      strictFailover: !!opts.strictFailover,
      preferProvenFailover: !!opts.preferProvenFailover,
      pinStrict: !!opts.strictPin && !!model,
      ...(opts.fixedRole ? { fixedRole: opts.fixedRole } : {}),
    },
  };
}

/** A tool-less turn is conversation, not analysis or code. */
export function nextTurn(state: RunPolicyState, turn: { hasTools: boolean }): TurnRequest {
  return {
    role: turn.hasTools ? (state.options.fixedRole ?? state.phase) : 'chat',
    model: state.model,
    strict: !!state.model && state.strictPin,
    excludeModels: [...state.broken],
  };
}

/** Whether `hand_off` belongs on this turn's menu — only while the run is planning, so
 *  a coder can never re-plan the work it was just given. */
export function offersHandOff(state: RunPolicyState): boolean {
  return state.phase === 'plan';
}

export function reduceRunPolicy(state: RunPolicyState, event: RunPolicyEvent): RunPolicyState {
  const s: RunPolicyState = { ...state, outcome: NONE };
  switch (event.type) {
    case 'turn_succeeded':
      return succeeded(s, event.model, event.acted === true);
    case 'code_change_attempted':
      // The analysis model just decided to change code; that edit is the first line of
      // the deliverable, so it is re-asked of the coding model. Only when nothing is
      // pinned or locked: a pinned model is the user's choice for the whole run.
      return s.phase === 'plan' && !s.model ? { ...s, phase: 'code', outcome: { kind: 'reask_as_coder' } } : s;
    case 'hand_off':
      return s.phase === 'plan'
        ? { ...s, phase: 'code', outcome: { kind: 'handed_off' } }
        : { ...s, outcome: { kind: 'hand_off_rejected' } };
    case 'verify_started':
      return { ...s, phase: 'verify' };
    case 'stalled':
      return stalled(s, event);
    case 'transport_failed':
      return transportFailed(s, event);
  }
}

function succeeded(s: RunPolicyState, resolved: string | undefined, acted: boolean): RunPolicyState {
  const proven = acted && resolved && resolved !== 'default' && !s.proven.includes(resolved)
    ? [...s.proven, resolved]
    : s.proven;
  const next = { ...s, turnRetries: 0, proven };
  // Lock the non-strict run onto what actually served it. A strict pin already
  // resolves to itself, so this is a no-op for one.
  if (s.options.lockAfterFirstSuccess && !(s.model && s.strictPin) && resolved && resolved !== 'default') {
    return { ...next, model: resolved, locked: true };
  }
  return next;
}

/**
 * The whole "this model is spent — who takes over?" decision: agent-stall's
 * `chooseStallFailover`, which the server reply loop and the on-prem runtime already
 * share, run over a COPY of `tried` so the reducer never mutates the state it was given.
 */
function stalled(s: RunPolicyState, e: Extract<RunPolicyEvent, { type: 'stalled' }>): RunPolicyState {
  const tried = [...s.tried];
  const to = chooseStallFailover({
    activeModel: s.model,
    resolvedModel: e.resolvedModel,
    tried,
    failoversUsed: s.failovers,
    maxFailovers: s.options.maxFailovers,
    surface: e.surface,
    pick: failoverPicker(s, e),
  });
  if (!to) {
    // Nothing to move to. A model the RUN chose — a lock, or an earlier failover's
    // target — is let go, and the run returns to its pin (or to auto-routing when there
    // is none): the next turn asks for the declared choice instead of re-asking the
    // model that just failed. A pin that is itself the spent model stays.
    const returned = s.model !== s.pin
      ? { model: s.pin, locked: false, strictPin: !!s.pin && s.options.pinStrict }
      : {};
    return { ...s, ...returned, tried, outcome: { kind: 'failover_exhausted', tried } };
  }
  const failovers = s.failovers + 1;
  return {
    ...s,
    tried,
    failovers,
    model: to,
    locked: false,
    ...(s.options.strictFailover ? { strictPin: true } : {}),
    outcome: { kind: 'failed_over', from: e.resolvedModel ?? s.model, to, attempt: failovers, of: s.options.maxFailovers },
  };
}

/**
 * Where a replacement comes from: a model that already acted in this run first (when
 * the run prefers one), then the host's own picker, then the model surface. Every
 * source skips the models the run routes around. Undefined when there is no source at
 * all, so `chooseStallFailover` keeps its "no source ⇒ no failover" answer.
 */
function failoverPicker(
  s: RunPolicyState,
  e: Extract<RunPolicyEvent, { type: 'stalled' }>,
): ((tried: readonly string[]) => string | undefined) | undefined {
  const proven = s.options.preferProvenFailover ? [...s.proven].reverse() : [];
  if (proven.length === 0 && !e.pick && !e.surface) return undefined;
  if (proven.length === 0 && s.broken.length === 0) return e.pick;
  return (tried) => {
    const skip = [...tried, ...s.broken];
    return proven.find((m) => !skip.includes(m))
      ?? (e.pick ? e.pick(skip) : nextFallbackModel(e.surface, skip));
  };
}

/**
 * Route around a transport failure, once per turn.
 *
 *  - A release status on a pin the run may drop, or on a lock, releases it for the rest
 *    of the run and retries on the gateway's cascade. So does a decline from a backend
 *    that declines ({@link RunPolicyOptions.decliningModelPrefixes}).
 *  - Any other 4xx refused the REQUEST, not the model: another model handed the same
 *    request gets the same answer, so the turn fails.
 *  - A model that broke after the gateway committed to it, under auto-routing or a
 *    LOCK, is left out of EVERY later turn, not just the retry — excluding it for the
 *    retry alone sent the next turn straight back to it (chat #105: the same model,
 *    eighteen turns). A lock is the run's own choice, so it is let go with the model.
 *  - A failure where the gateway was reached but no model is named retries without an
 *    exclusion; one where the gateway was never reached was already retried by the
 *    transport, and another model cannot help.
 *  - A pinned model that is not releasable is the user's choice: not routed around.
 */
function transportFailed(s: RunPolicyState, e: Extract<RunPolicyEvent, { type: 'transport_failed' }>): RunPolicyState {
  if (s.turnRetries >= 1 || e.kind === 'unreachable') return { ...s, outcome: { kind: 'fail_turn' } };
  const releasable = s.locked || s.options.pinReleasable;
  if (s.model && releasable && e.status !== undefined && releasesPin(s, s.model, e.status)) {
    return {
      ...s,
      model: undefined,
      locked: false,
      pin: undefined,
      strictPin: false,
      turnRetries: s.turnRetries + 1,
      outcome: { kind: 'retry_turn', released: s.model, status: e.status },
    };
  }
  if (isRequestRefusalStatus(e.status)) return { ...s, outcome: { kind: 'fail_turn' } };
  if (s.model && s.locked && e.kind === 'interrupted') {
    const brokenModel = e.model ?? s.model;
    return {
      ...s,
      model: undefined,
      locked: false,
      broken: s.broken.includes(brokenModel) ? s.broken : [...s.broken, brokenModel],
      turnRetries: s.turnRetries + 1,
      outcome: { kind: 'retry_turn', broken: brokenModel, released: s.model },
    };
  }
  if (s.model) return { ...s, outcome: { kind: 'fail_turn' } };
  const broken = e.kind === 'interrupted' && e.model && !s.broken.includes(e.model) ? [...s.broken, e.model] : s.broken;
  return {
    ...s,
    broken,
    turnRetries: s.turnRetries + 1,
    outcome: { kind: 'retry_turn', ...(e.kind === 'interrupted' && e.model ? { broken: e.model } : {}) },
  };
}

/** A release status, or a decline from a backend that declines. */
function releasesPin(s: RunPolicyState, model: string, status: number): boolean {
  return PIN_RELEASE_STATUSES.includes(status)
    || (status === DECLINE_STATUS && s.options.decliningModelPrefixes.some((prefix) => model.startsWith(prefix)));
}

/** A status that says the REQUEST was refused rather than the model failing — every 4xx
 *  but a timeout (408) and the release statuses, which are the model's. Exported so a
 *  host classifying a failed request reads the same line the policy draws. */
export function isRequestRefusalStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && !PIN_RELEASE_STATUSES.includes(status);
}
